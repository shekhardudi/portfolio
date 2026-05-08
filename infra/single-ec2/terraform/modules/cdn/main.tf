terraform {
  required_providers {
    aws = {
      source                = "hashicorp/aws"
      configuration_aliases = [aws.us_east_1]
    }
  }
}

variable "name_prefix" { type = string }
variable "domain_name" { type = string }
variable "apex_fqdn" { type = string }
variable "www_fqdn" { type = string }
variable "ec2_public_dns" { type = string }
variable "route53_zone_id" { type = string }
variable "tags" {
  type    = map(string)
  default = {}
}

# ---- ACM cert (must be in us-east-1 for CloudFront) ------------------------
resource "aws_acm_certificate" "wildcard" {
  provider    = aws.us_east_1
  domain_name = var.domain_name
  subject_alternative_names = [
    "*.${var.domain_name}"
  ]
  validation_method = "DNS"
  tags              = var.tags

  lifecycle { create_before_destroy = true }
}

resource "aws_route53_record" "cert_validation" {
  for_each = {
    for name, records in {
      for dvo in aws_acm_certificate.wildcard.domain_validation_options : dvo.resource_record_name => {
        name   = dvo.resource_record_name
        type   = dvo.resource_record_type
        record = dvo.resource_record_value
      }...
    } : name => records[0]
  }
  allow_overwrite = true
  zone_id         = var.route53_zone_id
  name            = each.value.name
  type            = each.value.type
  records         = [each.value.record]
  ttl             = 60
}

resource "aws_acm_certificate_validation" "wildcard" {
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.wildcard.arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

# ---- Single CloudFront distribution: apex + www -> EC2 :80 -----------------
# EC2 nginx is HTTP-only (no certbot); CloudFront terminates TLS for clients.
# SG already restricts origin port 80 to the CloudFront prefix list.
resource "aws_cloudfront_distribution" "site" {
  enabled         = true
  is_ipv6_enabled = true
  comment         = "${var.name_prefix} site"
  aliases         = [var.apex_fqdn, var.www_fqdn]
  price_class     = "PriceClass_100"
  http_version    = "http2"

  origin {
    domain_name = var.ec2_public_dns
    origin_id   = "ec2-origin"
    custom_origin_config {
      http_port                = 80
      https_port               = 443
      origin_protocol_policy   = "http-only"
      origin_ssl_protocols     = ["TLSv1.2"]
      origin_read_timeout      = 60
      origin_keepalive_timeout = 30
    }
    custom_header {
      name  = "X-CF-Origin"
      value = "shekharlabs"
    }
  }

  default_cache_behavior {
    target_origin_id       = "ec2-origin"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods         = ["GET", "HEAD", "OPTIONS"]
    compress               = true

    # Pass-through everything; nginx + apps handle their own caching.
    forwarded_values {
      query_string = true
      headers      = ["*"]
      cookies { forward = "all" }
    }
    min_ttl     = 0
    default_ttl = 0
    max_ttl     = 0
  }

  # Long-cache Next.js immutable static chunks (basePath = /portal).
  ordered_cache_behavior {
    path_pattern           = "/portal/_next/static/*"
    target_origin_id       = "ec2-origin"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD", "OPTIONS"]
    compress               = true

    forwarded_values {
      query_string = false
      cookies { forward = "none" }
    }
    min_ttl     = 0
    default_ttl = 86400
    max_ttl     = 31536000
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.wildcard.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  tags = var.tags
}

output "distribution_id" { value = aws_cloudfront_distribution.site.id }
output "acm_certificate_arn" { value = aws_acm_certificate_validation.wildcard.certificate_arn }

output "alias_target" {
  value = {
    name    = aws_cloudfront_distribution.site.domain_name
    zone_id = aws_cloudfront_distribution.site.hosted_zone_id
  }
}

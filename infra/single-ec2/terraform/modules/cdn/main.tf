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
variable "api_fqdn" { type = string }
variable "dashboards_fqdn" { type = string }
variable "ec2_public_dns" { type = string }
variable "ec2_eip" { type = string }
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
    for dvo in aws_acm_certificate.wildcard.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      type   = dvo.resource_record_type
      record = dvo.resource_record_value
    }
  }
  zone_id = var.route53_zone_id
  name    = each.value.name
  type    = each.value.type
  records = [each.value.record]
  ttl     = 60
}

resource "aws_acm_certificate_validation" "wildcard" {
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.wildcard.arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

# ---- CloudFront: api.shekharlabs.com -> EC2 :443 --------------------------
resource "aws_cloudfront_distribution" "api" {
  enabled         = true
  is_ipv6_enabled = true
  comment         = "${var.name_prefix} api"
  aliases         = [var.api_fqdn]
  price_class     = "PriceClass_100"

  origin {
    domain_name = var.ec2_public_dns
    origin_id   = "ec2-api"
    custom_origin_config {
      http_port                = 80
      https_port               = 443
      origin_protocol_policy   = "https-only"
      origin_ssl_protocols     = ["TLSv1.2"]
      origin_read_timeout      = 60
      origin_keepalive_timeout = 30
    }
    custom_header {
      name  = "X-CF-Origin"
      value = "shekharlabs-api"
    }
  }

  default_cache_behavior {
    target_origin_id       = "ec2-api"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods         = ["GET", "HEAD", "OPTIONS"]
    compress               = true

    # Disable caching for API (full pass-through)
    forwarded_values {
      query_string = true
      headers      = ["*"]
      cookies { forward = "all" }
    }
    min_ttl     = 0
    default_ttl = 0
    max_ttl     = 0
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

# ---- CloudFront: dashboards.shekharlabs.com -> EC2 :443 -------------------
resource "aws_cloudfront_distribution" "dashboards" {
  enabled         = true
  is_ipv6_enabled = true
  comment         = "${var.name_prefix} dashboards"
  aliases         = [var.dashboards_fqdn]
  price_class     = "PriceClass_100"

  origin {
    domain_name = var.ec2_public_dns
    origin_id   = "ec2-dashboards"
    custom_origin_config {
      http_port                = 80
      https_port               = 443
      origin_protocol_policy   = "https-only"
      origin_ssl_protocols     = ["TLSv1.2"]
      origin_read_timeout      = 60
      origin_keepalive_timeout = 30
    }
  }

  default_cache_behavior {
    target_origin_id       = "ec2-dashboards"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods         = ["GET", "HEAD", "OPTIONS"]
    compress               = true

    forwarded_values {
      query_string = true
      headers      = ["Authorization", "Host", "Origin", "Referer"]
      cookies { forward = "all" }
    }
    min_ttl     = 0
    default_ttl = 0
    max_ttl     = 0
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

output "api_distribution_id" { value = aws_cloudfront_distribution.api.id }
output "dashboards_distribution_id" { value = aws_cloudfront_distribution.dashboards.id }
output "acm_certificate_arn" { value = aws_acm_certificate_validation.wildcard.certificate_arn }

output "api_alias_target" {
  value = {
    name    = aws_cloudfront_distribution.api.domain_name
    zone_id = aws_cloudfront_distribution.api.hosted_zone_id
  }
}

output "dashboards_alias_target" {
  value = {
    name    = aws_cloudfront_distribution.dashboards.domain_name
    zone_id = aws_cloudfront_distribution.dashboards.hosted_zone_id
  }
}

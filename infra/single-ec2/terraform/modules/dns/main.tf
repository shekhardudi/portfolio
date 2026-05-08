# Apex + www alias records pointing at the single CloudFront distribution.
# Route53 zone is created at the root so ACM validation can read its id.

variable "domain_name" { type = string }
variable "apex_fqdn" { type = string }
variable "www_fqdn" { type = string }
variable "zone_id" { type = string }
variable "cf_alias_target" { type = object({ name = string, zone_id = string }) }
variable "tags" {
  type    = map(string)
  default = {}
}

resource "aws_route53_record" "apex" {
  zone_id = var.zone_id
  name    = var.apex_fqdn
  type    = "A"
  alias {
    name                   = var.cf_alias_target.name
    zone_id                = var.cf_alias_target.zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "www" {
  zone_id = var.zone_id
  name    = var.www_fqdn
  type    = "A"
  alias {
    name                   = var.cf_alias_target.name
    zone_id                = var.cf_alias_target.zone_id
    evaluate_target_health = false
  }
}

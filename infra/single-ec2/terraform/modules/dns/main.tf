# Note: the Route53 zone is created at the root, not here, so the cdn (ACM)
# and amplify (domain association) modules can read its id without a cycle.
# This module only owns the api.* and dashboards.* alias records.

variable "domain_name" { type = string }
variable "api_fqdn" { type = string }
variable "dashboards_fqdn" { type = string }
variable "zone_id" { type = string }
variable "api_cf_alias_target" { type = object({ name = string, zone_id = string }) }
variable "dashboards_cf_alias_target" { type = object({ name = string, zone_id = string }) }
variable "tags" {
  type    = map(string)
  default = {}
}

# api.* -> CloudFront in front of EC2
resource "aws_route53_record" "api" {
  zone_id = var.zone_id
  name    = var.api_fqdn
  type    = "A"
  alias {
    name                   = var.api_cf_alias_target.name
    zone_id                = var.api_cf_alias_target.zone_id
    evaluate_target_health = false
  }
}

# dashboards.* -> CloudFront in front of EC2 :5601
resource "aws_route53_record" "dashboards" {
  zone_id = var.zone_id
  name    = var.dashboards_fqdn
  type    = "A"
  alias {
    name                   = var.dashboards_cf_alias_target.name
    zone_id                = var.dashboards_cf_alias_target.zone_id
    evaluate_target_health = false
  }
}

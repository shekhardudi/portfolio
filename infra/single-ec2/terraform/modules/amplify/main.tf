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
variable "www_fqdn" { type = string }
variable "github_repo_url" { type = string }
variable "branch_name" { type = string }
variable "oauth_token" {
  type      = string
  sensitive = true
}
variable "api_base_url" { type = string }
variable "route53_zone_id" { type = string }
variable "tags" {
  type    = map(string)
  default = {}
}

# Amplify SSR app pointed at the GitHub repo. Build root = apps/web.
resource "aws_amplify_app" "web" {
  name                 = "${var.name_prefix}-web"
  repository           = var.github_repo_url
  access_token         = var.oauth_token
  platform             = "WEB_COMPUTE" # Next.js SSR
  iam_service_role_arn = aws_iam_role.amplify.arn

  environment_variables = {
    AMPLIFY_MONOREPO_APP_ROOT      = "apps/web"
    AMPLIFY_DIFF_DEPLOY            = "false"
    NEXT_PUBLIC_API_BASE_URL       = var.api_base_url
    NEXT_PUBLIC_INTELLI_SEARCH_API = "${var.api_base_url}/intelli-search"
    NEXT_PUBLIC_AGENTIC_HR_API     = "${var.api_base_url}/agentic-hr"
    NEXT_PUBLIC_LINKEDIN_API       = "${var.api_base_url}/linkedin-generator"
    NEXT_TELEMETRY_DISABLED        = "1"
  }

  build_spec = file("${path.module}/../../../../../apps/web/amplify.yml")

  tags = var.tags
}

resource "aws_amplify_branch" "main" {
  app_id      = aws_amplify_app.web.id
  branch_name = var.branch_name
  framework   = "Next.js - SSR"
  stage       = "PRODUCTION"

  enable_auto_build           = true
  enable_pull_request_preview = false
  tags                        = var.tags
}

# Custom domain — Amplify creates the certificate and verification CNAME.
# wait_for_verification=false because we let Terraform also write the
# Route53 verification records explicitly (cleaner than Amplify auto-discovery).
resource "aws_amplify_domain_association" "main" {
  app_id                = aws_amplify_app.web.id
  domain_name           = var.domain_name
  wait_for_verification = false

  sub_domain {
    branch_name = aws_amplify_branch.main.branch_name
    prefix      = "" # apex
  }
  sub_domain {
    branch_name = aws_amplify_branch.main.branch_name
    prefix      = "www"
  }

  depends_on = [aws_amplify_branch.main]
}

# Route53 records for ownership verification + apex/www CNAMEs.
# Amplify exposes the records to set via certificate_verification_dns_record
# and per-subdomain dns_record attributes.
resource "aws_route53_record" "amplify_cert_verify" {
  count   = length(aws_amplify_domain_association.main.certificate_verification_dns_record) > 0 ? 1 : 0
  zone_id = var.route53_zone_id
  name    = element(split(" ", aws_amplify_domain_association.main.certificate_verification_dns_record), 0)
  type    = element(split(" ", aws_amplify_domain_association.main.certificate_verification_dns_record), 1)
  records = [trimsuffix(element(split(" ", aws_amplify_domain_association.main.certificate_verification_dns_record), 2), ".")]
  ttl     = 300
}

resource "aws_route53_record" "amplify_subdomain" {
  for_each = { for sd in aws_amplify_domain_association.main.sub_domain : sd.prefix => sd }

  zone_id = var.route53_zone_id
  name    = each.key == "" ? var.domain_name : "${each.key}.${var.domain_name}"
  type    = element(split(" ", each.value.dns_record), 1)
  records = [trimsuffix(element(split(" ", each.value.dns_record), 2), ".")]
  ttl     = 300
}

# IAM service role for Amplify build + deploy
data "aws_iam_policy_document" "amplify_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["amplify.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "amplify" {
  name               = "${var.name_prefix}-amplify-role"
  assume_role_policy = data.aws_iam_policy_document.amplify_assume.json
  tags               = var.tags
}

resource "aws_iam_role_policy_attachment" "amplify_full" {
  role       = aws_iam_role.amplify.name
  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess-Amplify"
}

output "default_domain" { value = aws_amplify_app.web.default_domain }
output "app_id" { value = aws_amplify_app.web.id }

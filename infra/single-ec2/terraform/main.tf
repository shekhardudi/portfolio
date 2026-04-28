locals {
  name_prefix     = "${var.project}-${var.environment}"
  api_fqdn        = "${var.subdomains.api}.${var.domain_name}"
  dashboards_fqdn = "${var.subdomains.dashboards}.${var.domain_name}"
  www_fqdn        = "www.${var.domain_name}"

  tags = merge(var.common_tags, {
    Environment = var.environment
  })
}

provider "aws" {
  region = var.aws_region
  default_tags { tags = local.tags }
}

provider "aws" {
  alias  = "us_east_1"
  region = var.cloudfront_region
  default_tags { tags = local.tags }
}

# ---------------------------------------------------------------------------
# Route53 zone — created first so ACM validation + amplify domain assoc work
# ---------------------------------------------------------------------------
resource "aws_route53_zone" "primary" {
  name = var.domain_name
  tags = local.tags
}

# ---------------------------------------------------------------------------
# Network — VPC + subnet + IGW + SG + EIP
# ---------------------------------------------------------------------------
module "network" {
  source           = "./modules/network"
  name_prefix      = local.name_prefix
  aws_region       = var.aws_region
  ssh_ingress_cidr = var.ssh_ingress_cidr
  tags             = local.tags
}

# ---------------------------------------------------------------------------
# EC2 — single t3.xlarge box that runs the combined docker-compose
# ---------------------------------------------------------------------------
module "ec2" {
  source = "./modules/ec2"

  name_prefix       = local.name_prefix
  instance_type     = var.instance_type
  ebs_size_gb       = var.ebs_size_gb
  key_name          = var.key_name
  subnet_id         = module.network.public_subnet_id
  security_group_id = module.network.app_sg_id
  eip_allocation_id = module.network.eip_allocation_id
  github_repo_url   = var.github_repo_url
  ssm_param_path    = "/${var.project}/${var.environment}"
  api_fqdn          = local.api_fqdn
  dashboards_fqdn   = local.dashboards_fqdn
  tags              = local.tags
}

# ---------------------------------------------------------------------------
# CDN — CloudFront in front of EC2 for api.* and dashboards.*
# Owns ACM cert (us-east-1, wildcard).
# ---------------------------------------------------------------------------
module "cdn" {
  source = "./modules/cdn"
  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  name_prefix     = local.name_prefix
  domain_name     = var.domain_name
  api_fqdn        = local.api_fqdn
  dashboards_fqdn = local.dashboards_fqdn
  ec2_public_dns  = module.ec2.public_dns
  ec2_eip         = module.ec2.public_ip
  route53_zone_id = aws_route53_zone.primary.zone_id
  tags            = local.tags
}

# ---------------------------------------------------------------------------
# DNS — api / dashboards records (apex/www handled by amplify module)
# ---------------------------------------------------------------------------
module "dns" {
  source = "./modules/dns"

  domain_name                = var.domain_name
  zone_id                    = aws_route53_zone.primary.zone_id
  api_fqdn                   = local.api_fqdn
  dashboards_fqdn            = local.dashboards_fqdn
  api_cf_alias_target        = module.cdn.api_alias_target
  dashboards_cf_alias_target = module.cdn.dashboards_alias_target
  tags                       = local.tags
}

# ---------------------------------------------------------------------------
# Amplify — Next.js apps/web from GitHub
# ---------------------------------------------------------------------------
module "amplify" {
  source = "./modules/amplify"
  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  name_prefix     = local.name_prefix
  domain_name     = var.domain_name
  www_fqdn        = local.www_fqdn
  github_repo_url = var.github_repo_url
  branch_name     = var.amplify_branch
  oauth_token     = var.amplify_oauth_token
  api_base_url    = "https://${local.api_fqdn}"
  route53_zone_id = aws_route53_zone.primary.zone_id
  tags            = local.tags
}

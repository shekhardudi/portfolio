locals {
  name_prefix     = "${var.project}-${var.environment}"
  apex_fqdn       = var.domain_name
  www_fqdn        = "www.${var.domain_name}"
  route53_zone_id = var.existing_route53_zone_id != "" ? var.existing_route53_zone_id : aws_route53_zone.primary.zone_id

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
# Route53 zone — created first so ACM validation works without a cycle
# ---------------------------------------------------------------------------
resource "aws_route53_zone" "primary" {
  name = var.domain_name
  tags = local.tags
}

data "aws_route53_zone" "selected" {
  zone_id = local.route53_zone_id
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
  site_fqdn         = local.apex_fqdn
  tags              = local.tags
}

# ---------------------------------------------------------------------------
# CDN — single CloudFront distribution covering apex + www, fronts EC2 :80
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
  apex_fqdn       = local.apex_fqdn
  www_fqdn        = local.www_fqdn
  ec2_public_dns  = module.ec2.public_dns
  route53_zone_id = local.route53_zone_id
  tags            = local.tags
}

# ---------------------------------------------------------------------------
# DNS — apex + www records pointing at CloudFront
# ---------------------------------------------------------------------------
module "dns" {
  source = "./modules/dns"

  domain_name     = var.domain_name
  zone_id         = local.route53_zone_id
  apex_fqdn       = local.apex_fqdn
  www_fqdn        = local.www_fqdn
  cf_alias_target = module.cdn.alias_target
  tags            = local.tags
}

# ---------------------------------------------------------------------------
# CI/CD — IAM role assumed by GitHub Actions via OIDC for SSM-driven deploy
# ---------------------------------------------------------------------------
module "cicd" {
  source = "./modules/cicd"

  name_prefix  = local.name_prefix
  github_owner = var.github_owner
  github_repo  = var.github_repo
  instance_id  = module.ec2.instance_id
  tags         = local.tags
}

variable "project" {
  description = "Project name — tag prefix for all resources."
  type        = string
  default     = "portfolio"
}

variable "environment" {
  description = "Environment name (prod, staging, etc.)."
  type        = string
  default     = "prod"
}

variable "aws_region" {
  description = "Primary AWS region for VPC + EC2."
  type        = string
  default     = "ap-southeast-2"
}

# CloudFront + ACM (cert) MUST be in us-east-1, regardless of where EC2 lives.
variable "cloudfront_region" {
  description = "Region for CloudFront-bound ACM certs."
  type        = string
  default     = "us-east-1"
}

variable "domain_name" {
  description = "Apex domain managed by Route53."
  type        = string
  default     = "shekharlabs.com"
}

variable "existing_route53_zone_id" {
  description = "Optional pre-existing authoritative Route53 hosted zone ID to use for DNS and ACM validation."
  type        = string
  default     = ""
}

variable "instance_type" {
  description = "EC2 instance type."
  type        = string
  default     = "t3.xlarge"
}

variable "ebs_size_gb" {
  description = "Root volume size in GB."
  type        = number
  default     = 150
}

variable "ssh_ingress_cidr" {
  description = "Your laptop's public IP, e.g. 203.0.113.42/32. Restrict to /32."
  type        = string
}

variable "key_name" {
  description = "Existing EC2 key-pair name (managed outside TF)."
  type        = string
}

variable "github_repo_url" {
  description = "GitHub HTTPS clone URL of this portfolio repo (cloned by EC2 user-data)."
  type        = string
}

variable "github_owner" {
  description = "GitHub org/user slug for the repo (used in the GHA OIDC trust policy)."
  type        = string
}

variable "github_repo" {
  description = "GitHub repo name (used in the GHA OIDC trust policy)."
  type        = string
  default     = "portfolio"
}

variable "common_tags" {
  description = "Tags applied to every resource."
  type        = map(string)
  default = {
    Project   = "portfolio"
    ManagedBy = "terraform"
  }
}

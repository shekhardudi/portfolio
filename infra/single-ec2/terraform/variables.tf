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
  default     = "ap-south-1"
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

variable "subdomains" {
  description = "Subdomains the platform serves."
  type = object({
    api        = string
    dashboards = string
  })
  default = {
    api        = "api"
    dashboards = "dashboards"
  }
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
  description = "GitHub HTTPS clone URL of this portfolio repo."
  type        = string
}

variable "amplify_branch" {
  description = "Branch Amplify auto-deploys."
  type        = string
  default     = "main"
}

variable "amplify_oauth_token" {
  description = "GitHub PAT with `repo` scope for Amplify connector. Pass via TF_VAR_amplify_oauth_token."
  type        = string
  sensitive   = true
}

variable "common_tags" {
  description = "Tags applied to every resource."
  type        = map(string)
  default = {
    Project   = "portfolio"
    ManagedBy = "terraform"
  }
}

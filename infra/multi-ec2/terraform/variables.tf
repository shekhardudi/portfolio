variable "project" {
  type    = string
  default = "portfolio"
}

variable "environment" {
  type    = string
  default = "prod"
}

variable "aws_region" {
  type    = string
  default = "ap-south-1"
}

variable "vpc_cidr" {
  type    = string
  default = "10.50.0.0/16"
}

variable "public_subnet_cidrs" {
  type    = list(string)
  default = ["10.50.1.0/24", "10.50.2.0/24"]
}

variable "instance_type" {
  type    = string
  default = "t3.large"
}

variable "min_size" {
  type    = number
  default = 2
}

variable "desired_capacity" {
  type    = number
  default = 2
}

variable "max_size" {
  type    = number
  default = 4
}

variable "key_name" {
  type = string
}

variable "ssh_ingress_cidr" {
  type = string
}

variable "github_repo_url" {
  type = string
}

variable "ssm_param_path" {
  type    = string
  default = "/portfolio/prod"
}

variable "common_tags" {
  type = map(string)
  default = {
    Project   = "portfolio"
    ManagedBy = "terraform"
  }
}

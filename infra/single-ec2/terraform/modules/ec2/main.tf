variable "name_prefix" { type = string }
variable "instance_type" { type = string }
variable "ebs_size_gb" { type = number }
variable "key_name" { type = string }
variable "subnet_id" { type = string }
variable "security_group_id" { type = string }
variable "eip_allocation_id" { type = string }
variable "github_repo_url" { type = string }
variable "ssm_param_path" { type = string }
variable "tags" {
  type    = map(string)
  default = {}
}

variable "site_fqdn" {
  type        = string
  description = "Public site FQDN (apex). Passed to user-data for tagging/logging only."
}

# Latest Amazon Linux 2 AMI (we use AL2 for amazon-linux-extras)
data "aws_ami" "al2" {
  most_recent = true
  owners      = ["amazon"]
  filter {
    name   = "name"
    values = ["amzn2-ami-hvm-*-x86_64-gp2"]
  }
}

data "aws_region" "current" {}

# ---- IAM role: read SSM Parameter Store + write CloudWatch logs -----------
data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ec2" {
  name               = "${var.name_prefix}-ec2-role"
  assume_role_policy = data.aws_iam_policy_document.assume.json
  tags               = var.tags
}

data "aws_caller_identity" "me" {}

data "aws_iam_policy_document" "ssm_read" {
  statement {
    actions = [
      "ssm:GetParameter",
      "ssm:GetParameters",
      "ssm:GetParametersByPath",
    ]
    resources = [
      "arn:aws:ssm:${data.aws_region.current.name}:${data.aws_caller_identity.me.account_id}:parameter${var.ssm_param_path}/*"
    ]
  }
  statement {
    actions   = ["kms:Decrypt"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ssm.${data.aws_region.current.name}.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "ssm" {
  name   = "${var.name_prefix}-ssm-read"
  role   = aws_iam_role.ec2.id
  policy = data.aws_iam_policy_document.ssm_read.json
}

resource "aws_iam_role_policy_attachment" "ssm_managed" {
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "ec2" {
  name = "${var.name_prefix}-ec2-profile"
  role = aws_iam_role.ec2.name
}

# ---- Instance + EBS -------------------------------------------------------
resource "aws_instance" "host" {
  ami                    = data.aws_ami.al2.id
  instance_type          = var.instance_type
  subnet_id              = var.subnet_id
  vpc_security_group_ids = [var.security_group_id]
  key_name               = var.key_name
  iam_instance_profile   = aws_iam_instance_profile.ec2.name
  monitoring             = true

  user_data = templatefile("${path.module}/user-data.sh.tftpl", {
    github_repo_url = var.github_repo_url
    ssm_param_path  = var.ssm_param_path
    aws_region      = data.aws_region.current.name
    site_fqdn       = var.site_fqdn
  })

  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.ebs_size_gb
    delete_on_termination = false
    encrypted             = true
    tags                  = merge(var.tags, { Name = "${var.name_prefix}-root" })
  }

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required" # IMDSv2 only
    http_put_response_hop_limit = 2
  }

  lifecycle {
    ignore_changes = [ami, user_data]
  }

  tags = merge(var.tags, { Name = "${var.name_prefix}-host" })
}

resource "aws_eip_association" "host" {
  instance_id   = aws_instance.host.id
  allocation_id = var.eip_allocation_id
}

# ---- Daily EBS snapshot via DLM -------------------------------------------
data "aws_iam_policy_document" "dlm_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["dlm.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "dlm" {
  name               = "${var.name_prefix}-dlm-role"
  assume_role_policy = data.aws_iam_policy_document.dlm_assume.json
  tags               = var.tags
}

resource "aws_iam_role_policy_attachment" "dlm" {
  role       = aws_iam_role.dlm.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSDataLifecycleManagerServiceRole"
}

resource "aws_dlm_lifecycle_policy" "daily" {
  description        = "${var.name_prefix}-daily-ebs-snapshot-7d"
  execution_role_arn = aws_iam_role.dlm.arn
  state              = "ENABLED"

  policy_details {
    resource_types = ["VOLUME"]
    target_tags    = { Name = "${var.name_prefix}-root" }

    schedule {
      name = "daily-7d"
      create_rule {
        interval      = 24
        interval_unit = "HOURS"
        times         = ["03:00"]
      }
      retain_rule {
        count = 7
      }
      copy_tags = true
    }
  }
  tags = var.tags
}

output "instance_id" { value = aws_instance.host.id }
output "public_ip" { value = aws_instance.host.public_ip }
output "public_dns" { value = aws_instance.host.public_dns }

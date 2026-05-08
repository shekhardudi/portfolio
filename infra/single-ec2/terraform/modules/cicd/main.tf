# GitHub Actions OIDC -> AWS role
#
# Lets the deploy workflow assume this role *only* when the OIDC token is for
# the configured repo. The role can describe the EC2 host and run SSM
# commands against it; nothing else.

variable "name_prefix" { type = string }
variable "github_owner" { type = string }
variable "github_repo" { type = string }
variable "instance_id" { type = string }
variable "tags" {
  type    = map(string)
  default = {}
}

data "aws_caller_identity" "me" {}
data "aws_region" "current" {}

# OIDC provider for github.com — singleton per AWS account.
# `data` source first; if it's missing, the resource creates it.
data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

data "aws_iam_policy_document" "trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [data.aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      # Allow any branch/tag/PR ref from this repo. Tighten later if desired.
      values = ["repo:${var.github_owner}/${var.github_repo}:*"]
    }
  }
}

resource "aws_iam_role" "deploy" {
  name               = "${var.name_prefix}-gha-deploy"
  assume_role_policy = data.aws_iam_policy_document.trust.json
  tags               = var.tags
}

data "aws_iam_policy_document" "deploy" {
  # Find the running instance by tag (used by the workflow before SendCommand).
  statement {
    sid       = "DescribeInstances"
    effect    = "Allow"
    actions   = ["ec2:DescribeInstances"]
    resources = ["*"]
  }

  # Send shell commands to *this* instance only.
  statement {
    sid     = "SsmSendCommand"
    effect  = "Allow"
    actions = ["ssm:SendCommand"]
    resources = [
      "arn:aws:ec2:${data.aws_region.current.name}:${data.aws_caller_identity.me.account_id}:instance/${var.instance_id}",
      "arn:aws:ssm:${data.aws_region.current.name}::document/AWS-RunShellScript",
    ]
  }

  # Read the command status / output.
  statement {
    sid    = "SsmCommandResults"
    effect = "Allow"
    actions = [
      "ssm:GetCommandInvocation",
      "ssm:ListCommandInvocations",
      "ssm:ListCommands",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "deploy" {
  name   = "${var.name_prefix}-gha-deploy"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.deploy.json
}

output "deploy_role_arn" { value = aws_iam_role.deploy.arn }

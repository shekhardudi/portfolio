output "ec2_public_ip" {
  description = "Elastic IP attached to the EC2 host."
  value       = module.ec2.public_ip
}

output "ec2_public_dns" {
  description = "Public DNS for SSH."
  value       = module.ec2.public_dns
}

output "ec2_instance_id" {
  description = "EC2 instance id (use with `aws ssm start-session --target ...`)."
  value       = module.ec2.instance_id
}

output "site_url" {
  description = "Public site URL."
  value       = "https://${var.domain_name}"
}

output "cloudfront_distribution_id" {
  description = "Single CloudFront distribution fronting apex + www."
  value       = module.cdn.distribution_id
}

output "route53_name_servers" {
  description = "Set these at your domain registrar if the apex isn't already delegated."
  value       = data.aws_route53_zone.selected.name_servers
}

output "gha_deploy_role_arn" {
  description = "IAM role ARN that GitHub Actions assumes via OIDC for SSM-driven deploy."
  value       = module.cicd.deploy_role_arn
}

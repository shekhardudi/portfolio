output "ec2_public_ip" {
  description = "Elastic IP attached to the EC2 host."
  value       = module.ec2.public_ip
}

output "ec2_public_dns" {
  description = "Public DNS for SSH."
  value       = module.ec2.public_dns
}

output "amplify_default_domain" {
  description = "Amplify-provided default domain (before custom domain DNS validates)."
  value       = module.amplify.default_domain
}

output "api_url" {
  description = "Public API base URL (CloudFront-fronted)."
  value       = "https://${var.subdomains.api}.${var.domain_name}"
}

output "site_url" {
  description = "Public site URL."
  value       = "https://${var.domain_name}"
}

output "dashboards_url" {
  description = "Public OpenSearch Dashboards URL (basic-auth protected)."
  value       = "https://${var.subdomains.dashboards}.${var.domain_name}"
}

output "route53_name_servers" {
  description = "Set these at your domain registrar if the apex isn't already delegated."
  value       = aws_route53_zone.primary.name_servers
}

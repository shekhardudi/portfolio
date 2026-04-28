output "alb_dns_name" {
  value = aws_lb.api.dns_name
}

output "asg_name" {
  value = aws_autoscaling_group.app.name
}

output "target_group_arns" {
  value = {
    intelli_search     = aws_lb_target_group.intelli_search.arn
    agentic_hr         = aws_lb_target_group.agentic_hr.arn
    linkedin_generator = aws_lb_target_group.linkedin_generator.arn
  }
}

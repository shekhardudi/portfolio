locals {
  name_prefix = "${var.project}-${var.environment}-multi"
  tags = merge(var.common_tags, {
    Environment = var.environment
    Topology    = "multi-ec2"
  })
}

provider "aws" {
  region = var.aws_region
  default_tags {
    tags = local.tags
  }
}

data "aws_availability_zones" "available" {
  state = "available"
}

resource "aws_vpc" "this" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
}

resource "aws_subnet" "public" {
  for_each = { for i, cidr in var.public_subnet_cidrs : i => cidr }

  vpc_id                  = aws_vpc.this.id
  cidr_block              = each.value
  map_public_ip_on_launch = true
  availability_zone       = data.aws_availability_zones.available.names[tonumber(each.key)]

  tags = {
    Name = "${local.name_prefix}-public-${each.key}"
  }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }
}

resource "aws_route_table_association" "public" {
  for_each       = aws_subnet.public
  subnet_id      = each.value.id
  route_table_id = aws_route_table.public.id
}

resource "aws_security_group" "alb" {
  name   = "${local.name_prefix}-alb-sg"
  vpc_id = aws_vpc.this.id

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "app" {
  name   = "${local.name_prefix}-app-sg"
  vpc_id = aws_vpc.this.id

  ingress {
    from_port       = 8001
    to_port         = 8003
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.ssh_ingress_cidr]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_iam_role" "ec2" {
  name = "${local.name_prefix}-ec2-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ssm_managed" {
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "ec2" {
  name = "${local.name_prefix}-ec2-profile"
  role = aws_iam_role.ec2.name
}

data "aws_ami" "al2" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["amzn2-ami-hvm-*-x86_64-gp2"]
  }
}

resource "aws_launch_template" "app" {
  name_prefix   = "${local.name_prefix}-lt-"
  image_id      = data.aws_ami.al2.id
  instance_type = var.instance_type
  key_name      = var.key_name

  iam_instance_profile {
    name = aws_iam_instance_profile.ec2.name
  }

  vpc_security_group_ids = [aws_security_group.app.id]

  user_data = base64encode(templatefile("${path.module}/user-data.sh.tftpl", {
    github_repo_url = var.github_repo_url
    ssm_param_path  = var.ssm_param_path
    aws_region      = var.aws_region
  }))

  block_device_mappings {
    device_name = "/dev/xvda"
    ebs {
      volume_size           = 80
      volume_type           = "gp3"
      delete_on_termination = true
      encrypted             = true
    }
  }
}

resource "aws_lb" "api" {
  name               = substr(replace("${local.name_prefix}-alb", "_", "-"), 0, 32)
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = [for s in aws_subnet.public : s.id]
}

resource "aws_lb_target_group" "intelli_search" {
  name        = substr(replace("${local.name_prefix}-is", "_", "-"), 0, 32)
  port        = 8001
  protocol    = "HTTP"
  target_type = "instance"
  vpc_id      = aws_vpc.this.id
  health_check {
    path = "/health"
  }
}

resource "aws_lb_target_group" "agentic_hr" {
  name        = substr(replace("${local.name_prefix}-ahr", "_", "-"), 0, 32)
  port        = 8002
  protocol    = "HTTP"
  target_type = "instance"
  vpc_id      = aws_vpc.this.id
  health_check {
    path = "/health"
  }
}

resource "aws_lb_target_group" "linkedin_generator" {
  name        = substr(replace("${local.name_prefix}-lg", "_", "-"), 0, 32)
  port        = 8003
  protocol    = "HTTP"
  target_type = "instance"
  vpc_id      = aws_vpc.this.id
  health_check {
    path = "/health"
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.api.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.intelli_search.arn
  }
}

resource "aws_lb_listener_rule" "agentic_hr" {
  listener_arn = aws_lb_listener.http.arn
  priority     = 10

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.agentic_hr.arn
  }

  condition {
    path_pattern {
      values = ["/agentic-hr/*"]
    }
  }
}

resource "aws_lb_listener_rule" "linkedin_generator" {
  listener_arn = aws_lb_listener.http.arn
  priority     = 20

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.linkedin_generator.arn
  }

  condition {
    path_pattern {
      values = ["/linkedin-generator/*"]
    }
  }
}

resource "aws_autoscaling_group" "app" {
  name                = "${local.name_prefix}-asg"
  min_size            = var.min_size
  max_size            = var.max_size
  desired_capacity    = var.desired_capacity
  vpc_zone_identifier = [for s in aws_subnet.public : s.id]
  health_check_type   = "ELB"

  target_group_arns = [
    aws_lb_target_group.intelli_search.arn,
    aws_lb_target_group.agentic_hr.arn,
    aws_lb_target_group.linkedin_generator.arn,
  ]

  launch_template {
    id      = aws_launch_template.app.id
    version = "$Latest"
  }

  tag {
    key                 = "Name"
    value               = "${local.name_prefix}-node"
    propagate_at_launch = true
  }
}

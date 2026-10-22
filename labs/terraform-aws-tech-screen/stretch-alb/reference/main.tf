# Stretch: a two-AZ web application behind an internet-facing ALB.
# Targets live in private subnets; only the ALB is reachable from the
# internet. One NAT gateway (in AZ a) gives both private subnets egress for
# patches: a cost-conscious choice that loses egress if AZ a fails.
terraform {
  required_version = ">= 1.6.0, < 2.0.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.60"
    }
  }
}

provider "aws" {
  region = var.region
}

locals {
  tags = { project = var.name, managed_by = "terraform" }
  # Two AZs, each with one public and one private subnet.
  zones = {
    a = { az = data.aws_availability_zones.available.names[0], public = cidrsubnet(var.vpc_cidr, 8, 0), private = cidrsubnet(var.vpc_cidr, 8, 10) }
    b = { az = data.aws_availability_zones.available.names[1], public = cidrsubnet(var.vpc_cidr, 8, 1), private = cidrsubnet(var.vpc_cidr, 8, 11) }
  }
}

data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_ami" "al2023" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-2023.*-x86_64"]
  }

  filter {
    name   = "architecture"
    values = ["x86_64"]
  }
}

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = merge(local.tags, { Name = "${var.name}-vpc" })
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = local.tags
}

resource "aws_subnet" "public" {
  for_each = local.zones

  vpc_id            = aws_vpc.main.id
  cidr_block        = each.value.public
  availability_zone = each.value.az
  tags              = merge(local.tags, { Name = "${var.name}-public-${each.key}" })
}

resource "aws_subnet" "private" {
  for_each = local.zones

  vpc_id            = aws_vpc.main.id
  cidr_block        = each.value.private
  availability_zone = each.value.az
  tags              = merge(local.tags, { Name = "${var.name}-private-${each.key}" })
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  tags   = local.tags
}

resource "aws_route" "public_default" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.main.id
}

resource "aws_route_table_association" "public" {
  for_each = aws_subnet.public

  subnet_id      = each.value.id
  route_table_id = aws_route_table.public.id
}

resource "aws_eip" "nat" {
  domain = "vpc"
  tags   = local.tags
}

resource "aws_nat_gateway" "main" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public["a"].id
  depends_on    = [aws_internet_gateway.main]
  tags          = local.tags
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id
  tags   = local.tags
}

resource "aws_route" "private_default" {
  route_table_id         = aws_route_table.private.id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.main.id
}

resource "aws_route_table_association" "private" {
  for_each = aws_subnet.private

  subnet_id      = each.value.id
  route_table_id = aws_route_table.private.id
}

# ── security: internet → ALB → app, nothing else ────────────────────
resource "aws_security_group" "alb" {
  name_prefix = "${var.name}-alb-"
  description = "HTTP from the internet to the load balancer"
  vpc_id      = aws_vpc.main.id
  tags        = local.tags
}

resource "aws_security_group" "app" {
  name_prefix = "${var.name}-app-"
  description = "App port from the load balancer only"
  vpc_id      = aws_vpc.main.id
  tags        = local.tags
}

resource "aws_vpc_security_group_ingress_rule" "alb_http" {
  security_group_id = aws_security_group.alb.id
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "alb_to_app" {
  security_group_id            = aws_security_group.alb.id
  ip_protocol                  = "tcp"
  from_port                    = var.app_port
  to_port                      = var.app_port
  referenced_security_group_id = aws_security_group.app.id
}

resource "aws_vpc_security_group_ingress_rule" "app_from_alb" {
  security_group_id            = aws_security_group.app.id
  ip_protocol                  = "tcp"
  from_port                    = var.app_port
  to_port                      = var.app_port
  referenced_security_group_id = aws_security_group.alb.id
}

resource "aws_vpc_security_group_egress_rule" "app_https_out" {
  security_group_id = aws_security_group.app.id
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
}

# ── compute: one target per private subnet ──────────────────────────
resource "aws_instance" "app" {
  for_each = aws_subnet.private

  ami                         = data.aws_ami.al2023.id
  instance_type               = "t3.micro"
  subnet_id                   = each.value.id
  vpc_security_group_ids      = [aws_security_group.app.id]
  associate_public_ip_address = false

  metadata_options {
    http_tokens = "required"
  }

  # Python 3 ships with AL2023, so the app starts without any download;
  # NAT egress is for patching, not for the first boot.
  user_data = <<-EOT
    #!/bin/bash
    mkdir -p /srv/app && echo "ok from ${each.key}" > /srv/app/index.html
    cd /srv/app && nohup python3 -m http.server ${var.app_port} >/var/log/app.log 2>&1 &
  EOT

  tags = merge(local.tags, { Name = "${var.name}-app-${each.key}" })
}

# ── load balancer: listener → target group → registered targets ─────
resource "aws_lb" "web" {
  name_prefix        = "web-"
  load_balancer_type = "application"
  internal           = false
  security_groups    = [aws_security_group.alb.id]
  subnets            = [for s in aws_subnet.public : s.id]
  tags               = local.tags
}

resource "aws_lb_target_group" "app" {
  name_prefix = "app-"
  port        = var.app_port
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id

  health_check {
    path    = "/"
    matcher = "200"
  }
}

resource "aws_lb_target_group_attachment" "app" {
  for_each = aws_instance.app

  target_group_arn = aws_lb_target_group.app.arn
  target_id        = each.value.id
  port             = var.app_port
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.web.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }
}

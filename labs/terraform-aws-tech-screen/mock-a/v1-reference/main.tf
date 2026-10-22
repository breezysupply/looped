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
  tags = {
    project    = var.name
    managed_by = "terraform"
  }
  # Use the AZ you were given, or the first available one in the Region.
  az = coalesce(var.availability_zone, data.aws_availability_zones.available.names[0])
}

# Both data sources call AWS APIs during plan, so a real plan needs credentials.
data "aws_availability_zones" "available" {
  state = "available"
}

# Current Amazon Linux 2023 image for x86_64, owned by Amazon, in this Region.
# t3.micro is x86_64, so the architectures match. AL2023 uses dnf.
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

# ── network ─────────────────────────────────────────────────────────
resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = merge(local.tags, { Name = "${var.name}-vpc" })
}

resource "aws_subnet" "public" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = var.public_subnet_cidr
  availability_zone = local.az
  tags              = merge(local.tags, { Name = "${var.name}-public" })
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = merge(local.tags, { Name = "${var.name}-igw" })
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  tags   = merge(local.tags, { Name = "${var.name}-public" })
}

resource "aws_route" "public_default" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.main.id
}

# Without this the subnet would use the VPC's main route table (local only).
resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

# ── security ────────────────────────────────────────────────────────
resource "aws_security_group" "web" {
  name_prefix = "${var.name}-web-"
  description = "HTTP in from the allowed range; HTTPS out for package installs"
  vpc_id      = aws_vpc.main.id
  tags        = local.tags
}

resource "aws_vpc_security_group_ingress_rule" "http" {
  security_group_id = aws_security_group.web.id
  description       = "HTTP"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  cidr_ipv4         = var.http_ingress_cidr
}

# Terraform removes the default allow-all egress rule from groups it
# manages, so the outbound access the bootstrap needs is declared here.
resource "aws_vpc_security_group_egress_rule" "https_out" {
  security_group_id = aws_security_group.web.id
  description       = "HTTPS to package repositories"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
}

# ── compute ─────────────────────────────────────────────────────────
resource "aws_instance" "web" {
  ami                         = data.aws_ami.al2023.id
  instance_type               = var.instance_type
  subnet_id                   = aws_subnet.public.id
  vpc_security_group_ids      = [aws_security_group.web.id]
  associate_public_ip_address = true

  metadata_options {
    http_tokens = "required"
  }

  # Runs once at first boot. Demo only: plain HTTP, no TLS.
  user_data = <<-EOT
    #!/bin/bash
    set -euo pipefail
    dnf install -y nginx
    echo "hello from ${var.name}" > /usr/share/nginx/html/index.html
    systemctl enable --now nginx
  EOT

  # The bootstrap downloads packages, so the instance must not boot before
  # its subnet can reach the internet. Nothing above references the route or
  # the association, so this narrow dependency states it explicitly.
  depends_on = [aws_route.public_default, aws_route_table_association.public]

  tags = merge(local.tags, { Name = "${var.name}-web" })
}

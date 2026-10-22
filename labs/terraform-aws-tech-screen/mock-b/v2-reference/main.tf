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
  az = coalesce(var.availability_zone, data.aws_availability_zones.available.names[0])
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

# ── public side: where the NAT gateway lives ────────────────────────
resource "aws_subnet" "public" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = var.public_subnet_cidr
  availability_zone = local.az
  tags              = merge(local.tags, { Name = "${var.name}-public" })
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = local.tags
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

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

# A public NAT gateway needs an Elastic IP and must sit in a PUBLIC subnet:
# it forwards the worker's traffic out through the internet gateway.
resource "aws_eip" "nat" {
  domain = "vpc"
  tags   = merge(local.tags, { Name = "${var.name}-nat" })
}

resource "aws_nat_gateway" "main" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public.id
  tags          = merge(local.tags, { Name = "${var.name}-nat" })

  # The NAT gateway is only useful once the VPC has an attached IGW, and no
  # argument above references the IGW.
  depends_on = [aws_internet_gateway.main]
}

# ── private side: the worker ────────────────────────────────────────
resource "aws_subnet" "private" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = var.private_subnet_cidr
  availability_zone = local.az
  tags              = merge(local.tags, { Name = "${var.name}-private" })
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id
  tags   = merge(local.tags, { Name = "${var.name}-private" })
}

resource "aws_route" "private_default" {
  route_table_id         = aws_route_table.private.id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.main.id
}

resource "aws_route_table_association" "private" {
  subnet_id      = aws_subnet.private.id
  route_table_id = aws_route_table.private.id
}

# Stateful: replies to the worker's outbound connections are allowed back
# in automatically, so there is no ingress rule at all.
resource "aws_security_group" "worker" {
  name_prefix = "${var.name}-worker-"
  description = "Outbound HTTPS only; no inbound"
  vpc_id      = aws_vpc.main.id
  tags        = local.tags
}

resource "aws_vpc_security_group_egress_rule" "worker_partner" {
  security_group_id = aws_security_group.worker.id
  description       = "Partner API"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = var.partner_api_cidr
}

resource "aws_vpc_security_group_egress_rule" "worker_packages" {
  security_group_id = aws_security_group.worker.id
  description       = "Package repositories for the bootstrap"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = var.package_mirror_cidr
}

resource "aws_instance" "worker" {
  ami                         = data.aws_ami.al2023.id
  instance_type               = var.instance_type
  subnet_id                   = aws_subnet.private.id
  vpc_security_group_ids      = [aws_security_group.worker.id]
  associate_public_ip_address = false

  metadata_options {
    http_tokens = "required"
  }

  user_data = <<-EOT
    #!/bin/bash
    set -euo pipefail
    dnf install -y jq
    echo "worker bootstrapped" > /var/log/worker-bootstrap.log
  EOT

  # The bootstrap needs egress through the NAT gateway at first boot.
  depends_on = [aws_route.private_default, aws_route_table_association.private]

  tags = merge(local.tags, { Name = "${var.name}-worker" })
}

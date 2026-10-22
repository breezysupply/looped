# Build 2 (guided): one public web server.
# Network is done; security is half done; compute and outputs are yours.
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

# ── network (written for you: read every line) ─────────────────────
# Order in the file does not matter. Terraform builds a dependency graph
# from references like aws_vpc.main.id and creates things in that order.
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

# ── security (half done) ────────────────────────────────────────────
resource "aws_security_group" "web" {
  name_prefix = "${var.name}-web-"
  description = "HTTP in; HTTPS out for package installs"
  vpc_id      = aws_vpc.main.id # a group belongs to ONE VPC
  tags        = local.tags
}

# One rule per resource. ip_protocol "tcp", a port range, and a source.
resource "aws_vpc_security_group_ingress_rule" "http" {
  security_group_id = aws_security_group.web.id
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  cidr_ipv4         = var.http_ingress_cidr
}

# TODO: an aws_vpc_security_group_egress_rule allowing TCP 443 to 0.0.0.0/0.
# Terraform removes the default allow-all egress rule, and the bootstrap
# below needs HTTPS to reach the package repositories.

# ── compute (yours) ─────────────────────────────────────────────────
# TODO: resource "aws_instance" "web" with
#   ami                         = data.aws_ami.al2023.id
#   instance_type               = var.instance_type
#   subnet_id                   = the public subnet's id
#   vpc_security_group_ids      = a list holding the web group's id
#   associate_public_ip_address = true
#   user_data                   = a heredoc that runs: dnf install -y nginx
#                                 and systemctl enable --now nginx
#   depends_on                  = [the default route, the association]

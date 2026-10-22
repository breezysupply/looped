# Build 3 (guided). Everything through the NAT gateway is written and
# annotated. Build the private side using the comments as a checklist.
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

# ── private side (yours) ────────────────────────────────────────────
# TODO 1: aws_subnet "private" in the VPC with var.private_subnet_cidr and local.az

# TODO 2: aws_route_table "private" in the VPC

# TODO 3: aws_route "private_default": 0.0.0.0/0 with nat_gateway_id = the NAT
#         gateway's id (NOT gateway_id = the internet gateway)

# TODO 4: aws_route_table_association for the private subnet

# TODO 5: aws_security_group "worker" in the VPC, plus ONE egress rule for
#         TCP 443 to 0.0.0.0/0 and NO ingress rules

# TODO 6: aws_instance "worker": data.aws_ami.al2023.id, var.instance_type,
#         the private subnet, the worker group, associate_public_ip_address =
#         false, a user_data that runs `dnf install -y jq`, and
#         depends_on = [aws_route.private_default, aws_route_table_association.private]

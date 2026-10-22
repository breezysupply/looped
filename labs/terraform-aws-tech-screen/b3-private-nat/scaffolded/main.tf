# Build 3 (scaffolded). The public half is copied from Build 2's network and
# still works. You add the NAT gateway, the private side and the worker.
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
}

resource "aws_vpc" "main" {
  cidr_block = var.vpc_cidr
}

resource "aws_subnet" "public" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = var.public_subnet_cidr
  availability_zone = local.az
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
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

# TODO: Elastic IP (domain = "vpc") for the NAT gateway

# TODO: NAT gateway — which subnet does it belong in? What must exist first?

# TODO: private subnet (non-overlapping CIDR)

# TODO: private route table, 0.0.0.0/0 → the NAT gateway, and the association

# TODO: worker security group — egress only

# TODO: worker instance — private subnet, no public IP, bootstrap that
# needs egress, and the dependency that guarantees egress exists first

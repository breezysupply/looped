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
  # TODO: VPC reference, CIDR variable, availability_zone (variable or the
  # first entry of data.aws_availability_zones.available.names)
}

# TODO: internet gateway attached to the VPC

# TODO: route table in the VPC, a 0.0.0.0/0 route to the internet gateway,
# and an explicit association with the public subnet

resource "aws_security_group" "web" {
  # TODO: VPC, description
}

# TODO: ingress rule TCP 80 from var.http_ingress_cidr
# TODO: egress rule TCP 443 to 0.0.0.0/0

resource "aws_instance" "web" {
  # TODO: AMI, type, subnet, security group, public IP, user data,
  # and a narrow depends_on for the route the bootstrap needs
}

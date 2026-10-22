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
  # Derive the subnet from the VPC range instead of repeating a literal.
  app_subnet_cidr = cidrsubnet(var.vpc_cidr, 8, 1)
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

resource "aws_subnet" "app" {
  vpc_id     = aws_vpc.main.id
  cidr_block = local.app_subnet_cidr
}

resource "aws_instance" "app" {
  ami           = data.aws_ami.al2023.id
  instance_type = var.instance_type
  subnet_id     = aws_subnet.app.id
}

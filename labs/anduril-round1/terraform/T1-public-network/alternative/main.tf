# An equally valid style: inline route and inline security-group rules,
# literal CIDRs, a hard-coded Availability Zone. Different names, same graph.
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.60"
    }
  }
}

provider "aws" {
  region = "us-west-2"
}

resource "aws_vpc" "lab" {
  cidr_block = "10.20.0.0/16"
}

resource "aws_subnet" "edge" {
  vpc_id            = aws_vpc.lab.id
  cidr_block        = "10.20.10.0/24"
  availability_zone = "us-west-2a"
}

resource "aws_internet_gateway" "gw" {
  vpc_id = aws_vpc.lab.id
}

resource "aws_route_table" "edge" {
  vpc_id = aws_vpc.lab.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.gw.id
  }
}

resource "aws_route_table_association" "edge" {
  subnet_id      = aws_subnet.edge.id
  route_table_id = aws_route_table.edge.id
}

resource "aws_security_group" "edge" {
  name   = "edge-https"
  vpc_id = aws_vpc.lab.id

  ingress {
    description = "HTTPS"
    protocol    = "tcp"
    from_port   = 443
    to_port     = 443
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "SSH from admin"
    protocol    = "tcp"
    from_port   = 22
    to_port     = 22
    cidr_blocks = [var.admin_cidr]
  }

  egress {
    protocol    = "tcp"
    from_port   = 443
    to_port     = 443
    cidr_blocks = ["0.0.0.0/0"]
  }
}

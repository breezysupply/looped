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

# Two private subnets written out by hand. They differ only in CIDR and AZ,
# and each needs its own association — easy to forget the second one.
resource "aws_vpc" "main" {
  cidr_block = "10.90.0.0/16"
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id
}

resource "aws_subnet" "private_a" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.90.10.0/24"
  availability_zone = "${var.region}a"
}

resource "aws_subnet" "private_b" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.90.11.0/24"
  availability_zone = "${var.region}b"
}

resource "aws_route_table_association" "private_a" {
  subnet_id      = aws_subnet.private_a.id
  route_table_id = aws_route_table.private.id
}

resource "aws_route_table_association" "private_b" {
  subnet_id      = aws_subnet.private_a.id
  route_table_id = aws_route_table.private.id
}

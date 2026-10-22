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

resource "aws_vpc" "main" {
  cidr_block = "10.90.0.0/16"
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id
}

# One block, one instance per map key: aws_subnet.private["a"], ["b"].
# Keys are stable names, so adding "c" later never renumbers "a" or "b".
resource "aws_subnet" "private" {
  for_each = var.private_subnets

  vpc_id            = aws_vpc.main.id
  cidr_block        = each.value.cidr
  availability_zone = "${var.region}${each.value.az_suffix}"

  tags = {
    Name = "private-${each.key}"
  }
}

# Iterate over the subnets themselves, so every subnet gets exactly one
# association and the keys line up.
resource "aws_route_table_association" "private" {
  for_each = aws_subnet.private

  subnet_id      = each.value.id
  route_table_id = aws_route_table.private.id
}

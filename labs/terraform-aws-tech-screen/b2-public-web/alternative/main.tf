# Equally valid choices: an inline route on the route table, the public SSM
# parameter for the AMI, a literal AZ, Python's built-in web server so the
# bootstrap installs nothing, and different local names.
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.60"
    }
  }
}

provider "aws" {
  region = "us-east-2"
}

data "aws_ssm_parameter" "al2023" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}

resource "aws_vpc" "this" {
  cidr_block = "10.42.0.0/16"
}

resource "aws_subnet" "web" {
  vpc_id            = aws_vpc.this.id
  cidr_block        = "10.42.10.0/24"
  availability_zone = "us-east-2a"
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
}

resource "aws_route_table" "web" {
  vpc_id = aws_vpc.this.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }
}

resource "aws_route_table_association" "web" {
  subnet_id      = aws_subnet.web.id
  route_table_id = aws_route_table.web.id
}

resource "aws_security_group" "web" {
  name   = "web-http"
  vpc_id = aws_vpc.this.id
}

resource "aws_vpc_security_group_ingress_rule" "http" {
  security_group_id = aws_security_group.web.id
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "https" {
  security_group_id = aws_security_group.web.id
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_instance" "web" {
  ami                         = data.aws_ssm_parameter.al2023.insecure_value
  instance_type               = "t3.micro"
  subnet_id                   = aws_subnet.web.id
  vpc_security_group_ids      = [aws_security_group.web.id]
  associate_public_ip_address = true

  user_data = <<-EOT
    #!/bin/bash
    mkdir -p /srv/www && echo ok > /srv/www/index.html
    cd /srv/www && nohup python3 -m http.server 80 >/var/log/web.log 2>&1 &
  EOT
}

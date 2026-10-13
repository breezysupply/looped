# C01 — private object access through an S3 gateway endpoint with a scoped role.
# Local state. Run only in a sandbox account you own (see ../README.md).
terraform {
  required_version = ">= 1.10.0"
  required_providers {
    aws    = { source = "hashicorp/aws", version = "6.60.0" }
    random = { source = "hashicorp/random", version = "3.7.2" }
  }
}

variable "region" {
  type        = string
  description = "Sandbox region you chose (check prices there first)."
}

variable "instance_type" {
  type    = string
  default = "t4g.nano"
  validation {
    condition     = contains(["t4g.nano", "t4g.micro"], var.instance_type)
    error_message = "C01 allows only t4g.nano or t4g.micro."
  }
}

provider "aws" {
  region = var.region
  default_tags { tags = { "looped:lab" = "c01" } }
}

resource "random_id" "suffix" { byte_length = 4 }

data "aws_ami" "al2023" {
  most_recent = true
  owners      = ["amazon"]
  filter {
    name   = "name"
    values = ["al2023-ami-*-arm64"]
  }
}

data "aws_availability_zones" "available" { state = "available" }

resource "aws_vpc" "lab" {
  cidr_block           = "10.42.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true
}

resource "aws_subnet" "private" {
  vpc_id            = aws_vpc.lab.id
  cidr_block        = "10.42.1.0/24"
  availability_zone = data.aws_availability_zones.available.names[0]
}

resource "aws_route_table" "private" { vpc_id = aws_vpc.lab.id }

resource "aws_route_table_association" "private" {
  subnet_id      = aws_subnet.private.id
  route_table_id = aws_route_table.private.id
}

resource "aws_s3_bucket" "lab" {
  bucket        = "looped-c01-${random_id.suffix.hex}"
  force_destroy = true # synthetic data only; lets terraform destroy empty it
}

resource "aws_s3_bucket_public_access_block" "lab" {
  bucket                  = aws_s3_bucket.lab.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.lab.id
  service_name      = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.private.id]
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = "*"
      Action    = ["s3:GetObject", "s3:PutObject", "s3:ListBucket"]
      Resource  = [aws_s3_bucket.lab.arn, "${aws_s3_bucket.lab.arn}/*"]
    }]
  })
}

# Requests that do not arrive through the endpoint are denied, whoever sends them.
resource "aws_s3_bucket_policy" "via_endpoint_only" {
  bucket = aws_s3_bucket.lab.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "DenyOutsideEndpoint"
      Effect    = "Deny"
      Principal = "*"
      Action    = ["s3:GetObject", "s3:PutObject"]
      Resource  = ["${aws_s3_bucket.lab.arn}/*"]
      Condition = { StringNotEquals = { "aws:SourceVpce" = aws_vpc_endpoint.s3.id } }
    }]
  })
}

data "aws_iam_policy_document" "assume_ec2" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "app" {
  name               = "looped-c01-app-${random_id.suffix.hex}"
  assume_role_policy = data.aws_iam_policy_document.assume_ec2.json
}

resource "aws_iam_role_policy" "bucket_only" {
  name = "looped-c01-bucket-only"
  role = aws_iam_role.app.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["s3:ListBucket"], Resource = [aws_s3_bucket.lab.arn] },
      { Effect = "Allow", Action = ["s3:GetObject", "s3:PutObject"], Resource = ["${aws_s3_bucket.lab.arn}/*"] }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.app.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "app" {
  name = "looped-c01-app-${random_id.suffix.hex}"
  role = aws_iam_role.app.name
}

resource "aws_security_group" "app" {
  name   = "looped-c01-app"
  vpc_id = aws_vpc.lab.id
  egress {
    description = "HTTPS to AWS APIs (S3 via the gateway endpoint; SSM via its endpoints if you add them)"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_instance" "app" {
  ami                    = data.aws_ami.al2023.id
  instance_type          = var.instance_type
  subnet_id              = aws_subnet.private.id
  vpc_security_group_ids = [aws_security_group.app.id]
  iam_instance_profile   = aws_iam_instance_profile.app.name
  metadata_options { http_tokens = "required" }
  root_block_device {
    volume_size           = 8
    delete_on_termination = true
  }
}

output "bucket" { value = aws_s3_bucket.lab.bucket }
output "instance_id" { value = aws_instance.app.id }
output "endpoint_id" { value = aws_vpc_endpoint.s3.id }

variable "region" {
  type    = string
  default = "us-east-1"
}

variable "availability_zone" {
  description = "AZ for the subnet; null picks the first available AZ in the Region."
  type        = string
  default     = null
}

variable "name" {
  type    = string
  default = "mock-a-web"
}

variable "vpc_cidr" {
  type    = string
  default = "10.60.0.0/16"
}

variable "public_subnet_cidr" {
  type    = string
  default = "10.60.1.0/24"
}

variable "instance_type" {
  description = "Must match the AMI architecture (x86_64 here)."
  type        = string
  default     = "t3.micro"
}

variable "http_ingress_cidr" {
  description = "Who may reach port 80. 0.0.0.0/0 for a public demo; narrow it when you can."
  type        = string
  default     = "0.0.0.0/0"
}

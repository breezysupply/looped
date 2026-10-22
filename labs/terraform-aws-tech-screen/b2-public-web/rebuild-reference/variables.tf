variable "region" {
  type    = string
  default = "us-west-2"
}

variable "availability_zone" {
  description = "AZ for the subnet; null picks the first available AZ in the Region."
  type        = string
  default     = null
}

variable "name" {
  type    = string
  default = "orchard-web"
}

variable "vpc_cidr" {
  type    = string
  default = "10.77.0.0/16"
}

variable "public_subnet_cidr" {
  type    = string
  default = "10.77.4.0/24"
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

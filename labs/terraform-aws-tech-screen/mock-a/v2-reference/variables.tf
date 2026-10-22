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
  default = "mock-a-status"
}

variable "vpc_cidr" {
  type    = string
  default = "172.16.0.0/16"
}

variable "public_subnet_cidr" {
  type    = string
  default = "172.16.8.0/24"
}

variable "instance_type" {
  description = "Must match the AMI architecture (x86_64 here)."
  type        = string
  default     = "t3.micro"
}

variable "http_ingress_cidr" {
  description = "The office range allowed to reach the app port."
  type        = string
  default     = "198.51.100.0/24"
}

variable "app_port" {
  type    = number
  default = 8080

  validation {
    condition     = var.app_port >= 1024 && var.app_port <= 65535
    error_message = "Use an unprivileged port (1024-65535)."
  }
}

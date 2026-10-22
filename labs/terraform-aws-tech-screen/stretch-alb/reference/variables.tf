variable "region" {
  type    = string
  default = "us-east-1"
}

variable "name" {
  type    = string
  default = "ridgeline-app"
}

variable "vpc_cidr" {
  type    = string
  default = "10.100.0.0/16"
}

variable "app_port" {
  type    = number
  default = 8080
}

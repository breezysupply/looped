variable "region" {
  type    = string
  default = "us-east-1"
}

variable "name" {
  type    = string
  default = "metrics"
}

variable "vpc_cidr" {
  type    = string
  default = "10.50.0.0/16"
}

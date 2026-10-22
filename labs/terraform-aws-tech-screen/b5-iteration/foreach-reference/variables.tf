variable "region" {
  type    = string
  default = "us-east-1"
}

variable "private_subnets" {
  description = "Private subnets keyed by a stable short name."
  type = map(object({
    cidr      = string
    az_suffix = string
  }))
  default = {
    a = { cidr = "10.90.10.0/24", az_suffix = "a" }
    b = { cidr = "10.90.11.0/24", az_suffix = "b" }
  }
}

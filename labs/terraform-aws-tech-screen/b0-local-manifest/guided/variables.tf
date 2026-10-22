variable "project" {
  description = "Short project name, lowercase."
  type        = string
  default     = "ridgeline"
}

variable "environment" {
  description = "Deployment environment."
  type        = string
  default     = "dev"
}

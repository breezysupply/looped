output "deployment_name" {
  description = "Name computed from the inputs."
  value       = terraform_data.manifest.output.name
}

output "tags" {
  description = "The tag map stored in state."
  value       = terraform_data.manifest.output.tags
}

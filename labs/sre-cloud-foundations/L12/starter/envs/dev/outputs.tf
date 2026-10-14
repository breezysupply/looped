output "api_url" {
  description = "Beacon API for this environment (loopback only)."
  value       = "http://127.0.0.1:${var.api_port}"
}

output "container_id" {
  value = docker_container.api.id
}

output "data_volume" {
  value = docker_volume.data.name
}

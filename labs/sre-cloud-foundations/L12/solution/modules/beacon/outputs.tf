output "api_url" {
  value = "http://127.0.0.1:${var.api_port}"
}

output "container_id" {
  value = docker_container.api.id
}

output "data_volume" {
  value = docker_volume.data.name
}

output "network_id" {
  value = docker_network.beacon.id
}

output "image_id" {
  value = docker_image.python.image_id
}

output "id" {
  value = aws_instance.web.id
}

output "http_url" {
  value = "http://${aws_instance.web.public_ip}"
}

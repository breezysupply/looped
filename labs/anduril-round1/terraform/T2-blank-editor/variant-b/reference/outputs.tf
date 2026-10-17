output "public_dns" {
  value = aws_instance.api.public_dns
}

output "url" {
  value = "https://${aws_instance.api.public_dns}/"
}

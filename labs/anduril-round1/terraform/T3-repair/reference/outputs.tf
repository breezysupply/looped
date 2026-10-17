output "web_url" {
  value = "https://${aws_instance.web.public_dns}/"
}

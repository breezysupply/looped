output "instance_id" {
  value = aws_instance.web.id
}

output "url" {
  description = "Plain HTTP demo URL."
  value       = "http://${aws_instance.web.public_ip}:${var.app_port}/"
}

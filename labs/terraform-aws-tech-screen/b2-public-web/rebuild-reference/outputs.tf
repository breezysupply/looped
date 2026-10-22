output "instance_id" {
  value = aws_instance.site.id
}

output "url" {
  description = "Plain HTTP demo URL."
  value       = "http://${aws_instance.site.public_ip}/"
}

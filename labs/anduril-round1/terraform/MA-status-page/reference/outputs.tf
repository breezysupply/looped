output "instance_id" {
  value = aws_instance.status.id
}

output "public_ip" {
  value = aws_instance.status.public_ip
}

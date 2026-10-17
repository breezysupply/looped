output "id" {
  value = aws_instance.svc.id
}

output "address" {
  value = aws_eip.svc.public_ip
}

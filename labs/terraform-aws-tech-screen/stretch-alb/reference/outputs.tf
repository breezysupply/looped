output "alb_dns_name" {
  value = aws_lb.web.dns_name
}

output "url" {
  value = "http://${aws_lb.web.dns_name}/"
}

output "target_ids" {
  value = { for key, instance in aws_instance.app : key => instance.id }
}

# shellcheck shell=bash
# Sourced by harness/run-lab.sh. Lab 08 symptom: ledger-data Pending because
# StorageClass fast-ssd does not exist; ledger-db Pending; ledger-scratch
# Pending for a different reason (WaitForFirstConsumer, no consumer).
SYMPTOM_TIMEOUT=120
VERIFY_TIMEOUT=240
symptom_check() {
  [ "$(k get pvc ledger-data -o jsonpath='{.status.phase}')" = Pending ] || return 1
  [ "$(k get pvc ledger-scratch -o jsonpath='{.status.phase}')" = Pending ] || return 1
  [ -n "$(k get pods -l app=ledger-db --field-selector=status.phase=Pending -o name)" ] || return 1
  k get events --field-selector involvedObject.name=ledger-data | grep -q 'fast-ssd' || return 1
  k get events --field-selector involvedObject.name=ledger-scratch | grep -q 'WaitForFirstConsumer'
}
symptom_evidence() {
  k get pvc
  kc get storageclass
  k get pods -l app=ledger-db
  k get events --field-selector involvedObject.name=ledger-data -o custom-columns=REASON:.reason,MESSAGE:.message | tail -2
  k get events --field-selector involvedObject.name=ledger-scratch -o custom-columns=REASON:.reason,MESSAGE:.message | tail -1
  k get events --field-selector reason=FailedScheduling -o custom-columns=MESSAGE:.message | grep -i claim | tail -1
}

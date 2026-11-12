"""F013 documentation validation. Offline; no AWS clients, credentials or resources."""
import copy
from decimal import Decimal as D, ROUND_CEILING
import json
from pathlib import Path
import re
import subprocess
import sys
import unittest
from urllib.parse import urlparse, unquote
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "infra/tests"))
from wave3_support import Loader
import yaml
BASELINE = "6b761c19f5415dce45c1eecb493d0c55c6453074"
MODEL = ROOT / "docs/tv1/F013-cost-model.json"
GUIDE = ROOT / "ops/aws-lab-permissions-and-cost.md"
ALLOWED = {"ops/aws-lab-permissions-and-cost.md", "ops/README.md", "deploy/README.md", "docs/tv1/TV1-SUMMARY.md", "docs/tv1/F013-cost-model.json", "docs/tv1/F013-remediation-report.md", "docs/tv1/F013-validation.json", "ops/tests/test_cost_documentation.py"}

def template(name):
    return yaml.load((ROOT / "infra/cloudformation" / name).read_text(encoding="utf-8"), Loader=Loader)

def validate_inventory(model):
    actual = {}
    for name in model["inventory"]:
        doc = template(name)
        actual[name] = {key: {"type": value["Type"], "condition": value.get("Condition"), "deletion_policy": value.get("DeletionPolicy"), "update_replace_policy": value.get("UpdateReplacePolicy")} for key, value in doc["Resources"].items()}
    if actual != model["inventory"]:
        raise ValueError("CloudFormation inventory drift")
    storage, app = template("00-storage.yaml"), template("01-rds-beanstalk-cloudfront.yaml")
    options = {value["OptionName"]: value["Value"] for value in app["Resources"]["HandoverEbEnvironment"]["Properties"]["OptionSettings"]}
    facts = model["configuration"]
    expected = {"ec2_instance": app["Parameters"]["Ec2InstanceType"]["Default"], "rds_instance": app["Parameters"]["DbInstanceClass"]["Default"], "rds_storage_gb": app["Parameters"]["DbAllocatedStorageGb"]["Default"], "root_ebs_size_pinned": "RootVolumeSize" in options, "root_ebs_type_pinned": "RootVolumeType" in options, "lambda_memory_mb": storage["Parameters"]["LambdaMemoryMb"]["Default"], "lambda_architecture": storage["Resources"]["ChecksumFunction"]["Properties"]["Architectures"][0], "lambda_timeout_seconds": storage["Parameters"]["LambdaTimeoutSeconds"]["Default"], "cloudfront_price_class": app["Resources"]["PortalCloudFrontDistribution"]["Properties"]["DistributionConfig"]["PriceClass"], "alarm_count": sum(res["Type"] == "AWS::CloudWatch::Alarm" for doc in [storage, app] for res in doc["Resources"].values()), "associate_public_ipv4": options["AssociatePublicIpAddress"] == "true", "eb_environment": options["EnvironmentType"], "eb_log_days": int(options["RetentionInDays"]), "eb_delete_logs_on_terminate": options["DeleteOnTerminate"] == "true", "rds_private": not app["Resources"]["PortalDatabase"]["Properties"]["PubliclyAccessible"], "rds_single_az": not app["Resources"]["PortalDatabase"]["Properties"]["MultiAZ"], "rds_backup_days": app["Resources"]["PortalDatabase"]["Properties"]["BackupRetentionPeriod"]}
    if any(facts[key] != value for key, value in expected.items()):
        raise ValueError("Documented configuration drift")
    return actual

def costs(model, quantities):
    q = {key: D(value) for key, value in quantities.items()}
    r = {key: D(value["usd"]) for key, value in model["rates"].items()}
    if any(value < 0 for value in [*q.values(), *r.values()]):
        raise ValueError("Negative quantity/rate")
    month = D(model["month_hours"])
    duration_seconds = q["lambda_billed_duration_ms"].to_integral_value(rounding=ROUND_CEILING) / 1000
    total_s3 = sum(q[key] for key in ["s3_current_gb", "s3_noncurrent_gb", "s3_backup_gb", "s3_artifact_and_eb_gb", "s3_delete_markers_gb", "s3_incomplete_multipart_gb"])
    return {
        "ec2": q["ec2_running_hours"] * r["ec2_hour"],
        "ebs": q["ebs_root_gb"] * q["ebs_allocated_hours"] / month * r["ebs_gb_month"],
        "ipv4": q["public_ipv4_count"] * q["ipv4_allocated_hours"] * r["ipv4_hour"],
        "rds_compute": q["rds_running_hours"] * r["rds_hour"],
        "rds_storage": q["rds_gb"] * q["rds_allocated_hours"] / month * r["rds_storage_gb_month"],
        "rds_active_backups": q["active_backup_avg_gb"] * q["rds_allocated_hours"] / month * r["rds_backup_gb_month"],
        "post_demo_snapshots": q["post_demo_snapshot_gb"] * q["post_demo_snapshot_days"] / 30 * r["rds_backup_gb_month"],
        "s3_storage": total_s3 * q["s3_retained_hours"] / month * r["s3_gb_month"],
        "s3_requests": q["s3_put_requests"] * r["s3_put_request"] + q["s3_get_requests"] * r["s3_get_request"],
        "lambda_compute": q["lambda_invocations"] * q["lambda_memory_mb"] / 1024 * duration_seconds * r["lambda_compute"],
        "lambda_requests": q["lambda_invocations"] * r["lambda_request"],
        "cloudfront": q["cf_viewer_gb"] * r["cf_dto_gb"] + q["cf_https_requests"] * r["cf_https_request"] + q["cf_to_origin_gb"] * r["cf_to_origin_gb"],
        "s3_direct_transfer": q["s3_direct_download_gb"] * r["s3_internet_gb"],
        "cross_az": q["cross_az_billable_gb_sides"] * r["cross_az_gb_side"],
        "logs_ingestion": q["logs_ingested_gb"] * r["logs_ingest_gb"],
        "logs_storage": q["logs_avg_compressed_gb"] * q["logs_retained_hours"] / month * r["logs_stored_gb_month"],
        "alarms": q["standard_alarm_count"] * q["alarm_hours"] / month * r["alarm_month"],
        "sns": q["sns_requests"] * r["sns_request"] + q["sns_email_deliveries"] * r["sns_email"],
        "cpu_credits": q["ec2_excess_vcpu_hours"] * r["ec2_excess_vcpu_hour"] + q["rds_excess_vcpu_hours"] * r["rds_excess_vcpu_hour"],
    }

def validate_totals(model):
    for scenario in model["scenarios"].values():
        actual = costs(model, scenario["inputs"])
        if set(actual) != set(scenario["components_usd"]):
            raise ValueError("Missing cost component")
        if any(value.quantize(D("0.00000001")) != D(scenario["components_usd"][key]) for key, value in actual.items()):
            raise ValueError("Cost component arithmetic mismatch")
        total = sum(actual.values())
        if total.quantize(D("0.01")) != D(scenario["total_usd"]) or (total * (1 + D(scenario["contingency_percent"]) / 100)).quantize(D("0.01")) != D(scenario["with_contingency_usd"]):
            raise ValueError("Total arithmetic mismatch")

def validate_policies(model):
    account = model["account_state"]
    if any(account[key] != "UNVERIFIED" for key in ["credit", "free_tier", "budget_approved", "actual_aws_spend"]):
        raise ValueError("Account verification claim without evidence")
    rules = model["stop_rules"]
    if rules["rds_auto_restart_after_days"] != 7 or rules["stopped_rds_instance_hours_billed"] or not all(rules[key] for key in ["stopped_rds_storage_billed", "stopped_rds_backup_billed", "stopped_ec2_ebs_billed", "allocated_idle_eip_billed"]):
        raise ValueError("Incorrect stop billing policy")
    if rules["budget_is_hard_cap"] or rules["eb_manual_stop_is_reliable_schedule"]:
        raise ValueError("Unsupported budget/schedule guarantee")

class CostDocumentationTests(unittest.TestCase):
    def setUp(self):
        self.model = json.loads(MODEL.read_text(encoding="utf-8"))
        self.text = GUIDE.read_text(encoding="utf-8")
        self.q = copy.deepcopy(self.model["scenarios"]["continuous_35_days"]["inputs"])

    def test_TC_F013_01_inventory_matches_cloudformation(self):
        actual = validate_inventory(self.model)
        self.assertEqual(sum(len(items) for items in actual.values()), 26)
        wrong = copy.deepcopy(self.model)
        del wrong["inventory"]["00-storage.yaml"]["ChecksumFunction"]
        with self.assertRaisesRegex(ValueError, "inventory"):
            validate_inventory(wrong)
        wrong = copy.deepcopy(self.model)
        wrong["configuration"]["root_ebs_size_pinned"] = True
        with self.assertRaisesRegex(ValueError, "configuration"):
            validate_inventory(wrong)

    def test_TC_F013_02_versions_logs_snapshot_and_transfer_are_counted(self):
        base = costs(self.model, self.q)
        for key, component in [("s3_noncurrent_gb", "s3_storage"), ("s3_artifact_and_eb_gb", "s3_storage"), ("post_demo_snapshot_days", "post_demo_snapshots"), ("logs_avg_compressed_gb", "logs_storage"), ("s3_direct_download_gb", "s3_direct_transfer"), ("cross_az_billable_gb_sides", "cross_az"), ("cf_to_origin_gb", "cloudfront")]:
            with self.subTest(key=key):
                changed = dict(self.q, **{key: str(D(self.q[key]) + 1)})
                self.assertGreater(costs(self.model, changed)[component], base[component])
        self.assertFalse(self.model["configuration"]["rds_log_retention_pinned"])
        self.assertIn("Artifact", self.text)
        self.assertIn("DeleteOnTerminate=false", self.text)

    def test_TC_F013_03_lambda_uses_x86_gb_second_rate(self):
        match = re.search(r"(0[.]0000[0-9]+) / GB", self.text)
        self.assertIsNotNone(match, "Document a compute rate with explicit GB-second unit")
        self.assertEqual(D(match[1]), D("0.0000166667"))
        computed = costs(self.model, self.q)
        self.assertEqual(computed["lambda_compute"], D("0.1666670000"))
        self.assertEqual(computed["lambda_requests"], D("0.002"))
        timeout = costs(self.model, dict(self.q, lambda_billed_duration_ms="120000"))
        self.assertEqual(timeout["lambda_compute"] + timeout["lambda_requests"], D("10.0020200000"))
        bad = copy.deepcopy(self.model)
        bad["rates"]["lambda_compute"]["usd"] = "0.0000083"
        with self.assertRaisesRegex(ValueError, "arithmetic"):
            validate_totals(bad)
        rounded = costs(self.model, dict(self.q, lambda_billed_duration_ms="0.1"))
        self.assertEqual(rounded["lambda_compute"], D("0.0000833335000"))

    def test_TC_F013_04_allocation_clocks_are_independent(self):
        p = dict(self.q, ec2_running_hours="210", rds_running_hours="210")
        c = costs(self.model, p)
        self.assertEqual(c["ipv4"], D("4.200"))
        self.assertEqual(costs(self.model, dict(p, ipv4_allocated_hours="210"))["ipv4"], D("1.050"))
        self.assertEqual(c["ebs"], costs(self.model, self.q)["ebs"])
        self.assertEqual(c["rds_storage"], costs(self.model, self.q)["rds_storage"])
        self.assertGreater(c["rds_storage"], 0)
        with self.assertRaises(ValueError):
            costs(self.model, dict(p, ipv4_allocated_hours="-1"))

    def test_TC_F013_05_scenario_totals_and_units(self):
        validate_totals(self.model)
        self.assertEqual(self.model["scenarios"]["demo_48h"]["total_usd"], "5.51")
        self.assertEqual(self.model["scenarios"]["continuous_35_days"]["total_usd"], "46.43")
        for scenario in self.model["scenarios"].values():
            self.assertIn("$" + scenario["total_usd"], self.text)
            self.assertIn("$" + scenario["with_contingency_usd"], self.text)
        wrong = copy.deepcopy(self.model)
        del wrong["scenarios"]["demo_48h"]["components_usd"]["ipv4"]
        with self.assertRaisesRegex(ValueError, "Missing"):
            validate_totals(wrong)
        wrong = copy.deepcopy(self.model)
        wrong["scenarios"]["demo_48h"]["total_usd"] = "0.00"
        with self.assertRaisesRegex(ValueError, "arithmetic"):
            validate_totals(wrong)

    def test_TC_F013_06_credit_free_tier_and_account_claims(self):
        validate_policies(self.model)
        self.assertEqual(self.model["account_state"]["target"], "AWS_PERSONAL_ACCOUNT")
        self.assertIn("ACCOUNT_DEPENDENT", self.text)
        self.assertIn("personal account", self.text)
        self.assertIn("Academy Lab", self.text)
        wrong = copy.deepcopy(self.model)
        wrong["account_state"]["credit"] = "VERIFIED"
        with self.assertRaisesRegex(ValueError, "verification"):
            validate_policies(wrong)
        self.assertNotIn("hoàn toàn an toàn trong hạn mức", self.text)

    def test_TC_F013_07_stop_start_and_budget_policies(self):
        validate_policies(self.model)
        self.assertIn("tự khởi động lại sau 7 ngày", self.text)
        self.assertIn("Budget alerts không phải hard cap", self.text)
        wrong = copy.deepcopy(self.model)
        wrong["stop_rules"]["rds_auto_restart_after_days"] = 0
        with self.assertRaises(ValueError):
            validate_policies(wrong)
        wrong = copy.deepcopy(self.model)
        wrong["stop_rules"]["budget_is_hard_cap"] = True
        with self.assertRaisesRegex(ValueError, "guarantee"):
            validate_policies(wrong)

    def test_TC_F013_08_sources_are_official_dated_and_dimensioned(self):
        self.assertEqual(self.model["region"], "us-east-1")
        self.assertEqual(self.model["currency"], "USD")
        self.assertEqual(self.model["checked_date"], "2026-11-12")
        for value in self.model["rates"].values():
            self.assertGreater(D(value["usd"]), 0)
            source = self.model["sources"][value["source"]]
            self.assertEqual(source["checked_date"], self.model["checked_date"])
            self.assertIn(urlparse(source["url"]).hostname, {"aws.amazon.com", "docs.aws.amazon.com", "pricing.us-east-1.amazonaws.com"})
            self.assertIn(source["url"], self.text)
            if "sku" in value:
                self.assertLessEqual(value["effective_date"], self.model["checked_date"])
                self.assertTrue(value["dimensions"])
        ec2 = self.model["rates"]["ec2_hour"]["dimensions"]
        self.assertEqual((ec2["Operating System"], ec2["Tenancy"], ec2["CapacityStatus"], ec2["operation"]), ("Linux", "Shared", "Used", "RunInstances"))
        self.assertEqual(self.model["rates"]["cf_https_request"]["dimensions"]["Location"], "Europe")

    def test_TC_F013_09_cleanup_covers_retained_and_external_resources(self):
        text = self.text.split("## 7. Cleanup", 1)[1]
        self.assertIn("chưa chạy", text)
        for value in ["UploadBucket", "BackupBucket", "ChecksumLogGroup", "VersionId", "noncurrent", "delete markers", "multipart", "artifact bucket", "EIP", "EBS", "snapshot", "Cost Explorer"]:
            self.assertIn(value, text)
        self.assertLess(text.index("app stack trước"), text.index("3. Sau khi"))
        self.assertIn("không xóa shared", text.lower())
        self.assertIn("không ghi spend=0", text.lower())
        extra = costs(self.model, dict(self.q, sns_requests="100", sns_email_deliveries="100", ec2_excess_vcpu_hours="1", rds_excess_vcpu_hours="1"))
        self.assertEqual(extra["sns"], D("0.0020500000"))
        self.assertEqual(extra["cpu_credits"], D("0.125"))

    def test_TC_F013_10_only_documentation_and_direct_tests_change(self):
        # This scope assertion belongs to the F013 changeset, not every future feature.
        history = subprocess.check_output(["git", "log", "--format=%H %s"], cwd=ROOT, text=True, encoding="utf-8").splitlines()
        commit = next((line.split()[0] for line in history if line.endswith("docs(cost): clarify AWS cost and lab assumptions")), None)
        changed = subprocess.check_output(["git", "diff", BASELINE, *([commit] if commit else []), "--name-only"], cwd=ROOT, text=True, encoding="utf-8").splitlines()
        self.assertTrue(set(changed).issubset(ALLOWED), changed)
        self.assertEqual(subprocess.run(["git", "merge-base", "--is-ancestor", BASELINE, "HEAD"], cwd=ROOT).returncode, 0)
        for name in ["infra/cloudformation/00-storage.yaml", "infra/cloudformation/01-rds-beanstalk-cloudfront.yaml", "ops/verify_tv1_local_stack.py", "ops/tv1_evidence.py", "deploy/deploy_aws.ps1", "ops/backup_db_to_s3.py", "ops/restore_db_from_s3.py"]:
            original = subprocess.check_output(["git", "show", BASELINE + ":" + name], cwd=ROOT, text=True, encoding="utf-8")
            current = subprocess.check_output(["git", "show", commit + ":" + name], cwd=ROOT, text=True, encoding="utf-8") if commit else (ROOT / name).read_text(encoding="utf-8")
            self.assertEqual(original, current, name)

    def test_TC_F013_11_local_document_links_resolve(self):
        for name in ["ops/aws-lab-permissions-and-cost.md", "ops/README.md", "deploy/README.md", "docs/tv1/TV1-SUMMARY.md"]:
            path = ROOT / name
            for target in re.findall(r"\[[^\]]*\]\(([^)]+)\)", path.read_text(encoding="utf-8")):
                if urlparse(target).scheme or target.startswith("#"):
                    continue
                destination = (path.parent / unquote(target.split("#", 1)[0])).resolve()
                self.assertTrue(destination.is_file() or (target.endswith("/") and destination.is_dir()), (name, target))

if __name__ == "__main__":
    unittest.main(verbosity=2)

import hashlib
import io
import json
import unittest
from types import SimpleNamespace
from urllib.parse import quote_plus

import importlib.util
from pathlib import Path

_source = Path(__file__).resolve().parents[1] / "lambda" / "lambda_function.py"
_spec = importlib.util.spec_from_file_location("checksum_lambda", _source)
worker = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(worker)
MAX_FILE_BYTES, RESULT_FIELDS = worker.MAX_FILE_BYTES, worker.RESULT_FIELDS
process_records, result_key = worker.process_records, worker.result_key


class FakeClientError(Exception):
    def __init__(self, status):
        self.response = {"ResponseMetadata": {"HTTPStatusCode": status}}


class FakeS3:
    exceptions = SimpleNamespace(ClientError=FakeClientError)

    def __init__(self):
        self.sources = {}
        self.saved = {}
        self.calls = []
        self.streams = []
        self.get_error = self.put_error = None
        self.reported_size = self.reported_version = None

    def get_object(self, **request):
        self.calls.append(("get", request))
        if self.get_error:
            raise self.get_error
        if "VersionId" in request:
            version = request["VersionId"]
            data = self.sources[version]
            response = {"ContentLength": self.reported_size if self.reported_size is not None else len(data),
                        "VersionId": self.reported_version or version}
        else:
            data = self.saved[request["Key"]]
            response = {"ContentLength": len(data)}
        response["Body"] = io.BytesIO(data)
        self.streams.append(response["Body"])
        return response

    def put_object(self, **request):
        self.calls.append(("put", request))
        if self.put_error:
            raise self.put_error
        assert request["IfNoneMatch"] == "*"
        assert request["ContentType"] == "application/json"
        if request["Key"] in self.saved:
            raise FakeClientError(412)
        self.saved[request["Key"]] = request["Body"]


class TestChecksumLambda(unittest.TestCase):
    BUCKET = "fixture-bucket"
    KEY = "uploads/a +%=.pdf"
    VERSION = "v+/=%"
    SHARED_KEY = "results/fbbc3334e2325e09e43cb32dd41ba6e63d0f3ffad0bf108a1cb0db971610f8b7/552e151a9beecf2fac5516946aeda4c549ef15326dc59f62256c776c527cbeac/ca01fa40730897dffb94f2dec149a942d49c1c9ec9c95f1ddf0db7cc9328a85e.json"

    def setUp(self):
        self.s3 = FakeS3()
        self.s3.sources[self.VERSION] = b"abc"

    def event(self, version=VERSION, key=KEY, bucket=BUCKET):
        return {"Records": [{"eventSource": "aws:s3", "eventName": "ObjectCreated:Put",
                             "s3": {"bucket": {"name": bucket},
                                    "object": {"key": quote_plus(key), "versionId": version}}}]}

    def run_event(self, event=None):
        return process_records(event or self.event(), self.s3, self.BUCKET)

    def test_success_matches_backend_identity_schema_and_shared_key(self):
        self.assertEqual(self.run_event(), {"created": 1, "skipped": 0})
        self.assertEqual(result_key(self.BUCKET, self.KEY, self.VERSION), self.SHARED_KEY)
        result = json.loads(self.s3.saved[self.SHARED_KEY])
        self.assertEqual(set(result), RESULT_FIELDS)
        self.assertEqual(result["size"], 3)
        self.assertEqual(result["status"], "SUCCEEDED")
        self.assertEqual(result["actualSha256"], hashlib.sha256(b"abc").hexdigest())
        self.assertIsNone(result["errorCode"])
        self.assertEqual(self.s3.calls[0][1], {"Bucket": self.BUCKET, "Key": self.KEY, "VersionId": self.VERSION})
        self.assertTrue(all(stream.closed for stream in self.s3.streams))

    def test_duplicate_preserves_bytes_and_checks_existing_result(self):
        self.run_event()
        first = self.s3.saved[self.SHARED_KEY]
        self.assertEqual(self.run_event(), {"created": 0, "skipped": 1})
        self.assertEqual(self.s3.saved[self.SHARED_KEY], first)
        self.assertTrue(all(stream.closed for stream in self.s3.streams))

    def test_duplicate_with_conflicting_hash_is_rejected(self):
        self.run_event()
        saved = json.loads(self.s3.saved[self.SHARED_KEY])
        saved["actualSha256"] = "0" * 64
        self.s3.saved[self.SHARED_KEY] = json.dumps(saved).encode()
        with self.assertRaises(ValueError): self.run_event()

    def test_existing_result_extra_fields_or_bad_types_are_rejected(self):
        self.run_event()
        original = json.loads(self.s3.saved[self.SHARED_KEY])
        for extra in ({"schemaVersion": True}, {"writeStatus": "CREATED"}, {"processedAt": "invalid"}):
            self.s3.saved[self.SHARED_KEY] = json.dumps(dict(original, **extra)).encode()
            with self.assertRaises(ValueError): self.run_event()

    def test_existing_result_duplicate_fields_or_oversize_are_rejected(self):
        for data in (b'{"schemaVersion":1,"schemaVersion":1}', b" " * 65537):
            self.s3.saved[self.SHARED_KEY] = data
            with self.assertRaises(ValueError): self.run_event()
        self.assertTrue(all(stream.closed for stream in self.s3.streams))

    def test_events_for_two_versions_can_arrive_in_reverse_order(self):
        self.s3.sources["v2"] = b"new contents"
        for version in ("v2", self.VERSION, "v2", self.VERSION):
            self.run_event(self.event(version=version))
        self.assertEqual(len(self.s3.saved), 2)
        self.assertEqual(json.loads(self.s3.saved[self.SHARED_KEY])["actualSha256"], hashlib.sha256(b"abc").hexdigest())

    def test_results_other_buckets_deletes_and_non_s3_events_are_ignored(self):
        for event in (self.event(key="results/already.json"), self.event(bucket="other"),
                      self.event(key="uploads/folder/")):
            self.assertEqual(self.run_event(event), {"created": 0, "skipped": 0})
        for field, value in (("eventSource", "other"), ("eventName", "ObjectRemoved:Delete")):
            event = self.event(); event["Records"][0][field] = value
            self.run_event(event)
        self.assertEqual(self.s3.calls, [])

    def test_missing_blank_literal_null_or_nonstring_version_is_rejected(self):
        for value in (None, "", " ", "null", 123):
            with self.assertRaises(ValueError): self.run_event(self.event(version=value))
        self.assertEqual(self.s3.calls, [])

    def test_wrong_response_version_never_writes_a_result(self):
        self.s3.reported_version = "wrong"
        with self.assertRaises(ValueError): self.run_event()
        self.assertEqual(self.s3.saved, {})
        self.assertTrue(all(stream.closed for stream in self.s3.streams))

    def test_incomplete_or_longer_than_reported_stream_never_succeeds(self):
        for size in (2, 4):
            self.s3.reported_size = size
            with self.assertRaises(ValueError): self.run_event()
        self.assertEqual(self.s3.saved, {})
        self.assertTrue(all(stream.closed for stream in self.s3.streams))

    def test_file_too_large_produces_failed_with_no_hash(self):
        self.s3.reported_size = MAX_FILE_BYTES + 1
        self.run_event()
        result = json.loads(self.s3.saved[self.SHARED_KEY])
        self.assertEqual(result["status"], "FAILED")
        self.assertIsNone(result["actualSha256"])
        self.assertEqual(result["errorCode"], "FILE_TOO_LARGE")
        self.assertTrue(self.s3.streams[0].closed)

    def test_storage_and_timeout_errors_propagate_without_false_result(self):
        for error in (FakeClientError(403), FakeClientError(503), TimeoutError("fixture")):
            self.s3.get_error = error
            with self.assertRaises(type(error)): self.run_event()
        self.assertEqual(self.s3.saved, {})

    def test_write_conflicts_and_server_errors_propagate_for_retry(self):
        for status in (409, 503):
            self.s3.put_error = FakeClientError(status)
            with self.assertRaises(FakeClientError): self.run_event()
        self.assertEqual(self.s3.saved, {})

    def test_empty_bucket_configuration_is_rejected(self):
        with self.assertRaises(ValueError): process_records(self.event(), self.s3, "")
        self.assertEqual(self.s3.calls, [])

    def test_invalid_size_headers_never_produce_a_result(self):
        original_get = self.s3.get_object
        for size in (None, 0, -1, True, 3.0, "3"):
            def get_with_bad_size(**request):
                response = original_get(**request)
                response["ContentLength"] = size
                return response
            self.s3.get_object = get_with_bad_size
            with self.assertRaises(ValueError): self.run_event()
        self.assertEqual(self.s3.saved, {})
        self.assertTrue(all(stream.closed for stream in self.s3.streams))

    def test_source_read_timeout_closes_stream_and_never_writes_result(self):
        class BrokenBody(io.BytesIO):
            def read(self, *args): raise TimeoutError("fixture read timeout")
        body = BrokenBody(b"unused")
        self.s3.get_object = lambda **request: {"Body": body, "ContentLength": 3, "VersionId": self.VERSION}
        with self.assertRaises(TimeoutError): self.run_event()
        self.assertTrue(body.closed)
        self.assertEqual(self.s3.saved, {})

    def test_duplicate_wrong_identity_size_or_status_is_rejected(self):
        self.run_event()
        original = json.loads(self.s3.saved[self.SHARED_KEY])
        for fields in ({"bucket": "other"}, {"objectKey": "uploads/other"}, {"versionId": "other"},
                       {"size": 4}, {"status": "HASHED"}, {"errorCode": "unexpected"}):
            self.s3.saved[self.SHARED_KEY] = json.dumps(dict(original, **fields)).encode()
            with self.assertRaises(ValueError): self.run_event()

    def test_duplicate_result_read_timeout_propagates(self):
        self.run_event()
        original_get = self.s3.get_object
        class BrokenBody(io.BytesIO):
            def read(self, *args): raise TimeoutError("fixture result timeout")
        body = BrokenBody(b"unused")
        def get_with_broken_result(**request):
            if "VersionId" in request: return original_get(**request)
            return {"Body": body}
        self.s3.get_object = get_with_broken_result
        with self.assertRaises(TimeoutError): self.run_event()
        self.assertTrue(body.closed)

    def test_duplicate_timestamp_must_match_java_offset_datetime_contract(self):
        self.run_event()
        original = json.loads(self.s3.saved[self.SHARED_KEY])
        for timestamp in ("2026-11-10 10:00:00+00:00", "2026-11-10T10:00:00+0000",
                          "20261110T100000Z", "2026-11-10T10:00:00+19:00",
                          "2026-11-10T10:00:00.1234567890Z", "2026-11-10T10:00:00+00:60"):
            with self.subTest(timestamp=timestamp):
                data = json.dumps(dict(original, processedAt=timestamp)).encode()
                self.s3.saved[self.SHARED_KEY] = data
                with self.assertRaises(ValueError): self.run_event()
                self.assertEqual(self.s3.saved[self.SHARED_KEY], data)
        for timestamp in ("2026-11-10T10:00:00Z", "2026-11-10T17:00:00.123456789+07:00"):
            self.s3.saved[self.SHARED_KEY] = json.dumps(dict(original, processedAt=timestamp)).encode()
            self.assertEqual(self.run_event(), {"created": 0, "skipped": 1})

    def test_malformed_upload_events_never_write_success(self):
        for field in ("s3", "eventName"):
            event = self.event(); del event["Records"][0][field]
            if field == "eventName":
                self.assertEqual(self.run_event(event), {"created": 0, "skipped": 0})
            else:
                with self.assertRaises(KeyError): self.run_event(event)
        event = self.event(); del event["Records"][0]["s3"]["object"]["key"]
        with self.assertRaises(KeyError): self.run_event(event)
        self.assertEqual(self.s3.saved, {})


if __name__ == "__main__":
    unittest.main()

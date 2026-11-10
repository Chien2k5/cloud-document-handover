import importlib.util
import io
import json
from pathlib import Path
import types
import unittest
from unittest.mock import Mock, patch

from test_checksum_lambda import FakeClientError, FakeS3, worker
import test_checksum_lambda as fixtures


def load_adapter(client):
    boto = types.ModuleType("boto3")
    boto.client = Mock(return_value=client)
    config_module = types.ModuleType("botocore.config")
    config_module.Config = Mock(side_effect=lambda **kwargs: types.SimpleNamespace(**kwargs))
    modules = {"boto3": boto, "botocore": types.ModuleType("botocore"),
               "botocore.config": config_module}
    source = Path(__file__).resolve().parents[1] / "s3_adapter" / "s3_adapter.py"
    spec = importlib.util.spec_from_file_location("test_s3_adapter", source)
    adapter = importlib.util.module_from_spec(spec)
    with patch.dict("sys.modules", modules):
        spec.loader.exec_module(adapter)
    return adapter, boto, config_module


class TestChecksumReader(unittest.TestCase):
    def setUp(self):
        self.client = FakeS3()
        self.adapter, self.boto, self.config = load_adapter(self.client)
        self.adapter.BUCKET = fixtures.TestChecksumLambda.BUCKET
        self.key, self.version = fixtures.TestChecksumLambda.KEY, fixtures.TestChecksumLambda.VERSION
        self.destination = fixtures.TestChecksumLambda.SHARED_KEY

    def test_lambda_writer_and_python_reader_use_the_same_backend_key(self):
        fixture = fixtures.TestChecksumLambda(); fixture.setUp()
        fixture.run_event()
        self.client.saved.update(fixture.s3.saved)
        saved = self.adapter.get_checksum_result(self.key, self.version)
        self.assertEqual(saved["schemaVersion"], 1)
        self.assertEqual(saved["status"], "SUCCEEDED")
        self.assertEqual(saved["versionId"], self.version)
        self.assertEqual(self.client.calls[-1][1]["Key"], self.destination)
        self.assertTrue(self.client.streams[-1].closed)

    def test_oversized_malformed_and_duplicate_json_close_the_body(self):
        for data in (b" " * 65537, b"invalid", b'{"size":3,"size":3}'):
            self.client.saved[self.destination] = data
            with self.assertRaises(ValueError): self.adapter.get_checksum_result(self.key, self.version)
            self.assertTrue(self.client.streams[-1].closed)

    def test_reader_timeout_closes_stream_and_propagates(self):
        class BrokenBody(io.BytesIO):
            def read(self, *args): raise TimeoutError("fixture timeout")
        body = BrokenBody(b"unused")
        self.client.get_object = lambda **request: {"Body": body}
        with self.assertRaises(TimeoutError): self.adapter.get_checksum_result(self.key, self.version)
        self.assertTrue(body.closed)

    def test_missing_and_denied_results_are_not_converted_to_success(self):
        for status in (404, 403, 503):
            self.client.get_error = FakeClientError(status)
            with self.assertRaises(FakeClientError): self.adapter.get_checksum_result(self.key, self.version)

    def test_literal_null_version_is_rejected_without_s3_calls(self):
        with self.assertRaises(ValueError): self.adapter.get_checksum_result(self.key, "null")
        self.assertEqual(self.client.calls, [])

    def test_python_adapter_configures_bounded_sdk_timeouts(self):
        kwargs = self.config.Config.call_args.kwargs
        self.assertEqual(kwargs["connect_timeout"], 3)
        self.assertEqual(kwargs["read_timeout"], 3)
        self.assertEqual(kwargs["retries"]["total_max_attempts"], 3)


class TestLambdaHandler(unittest.TestCase):
    def test_handler_configures_timeouts_and_reuses_client(self):
        fixture = fixtures.TestChecksumLambda(); fixture.setUp()
        boto = types.ModuleType("boto3"); boto.client = Mock(return_value=fixture.s3)
        config_module = types.ModuleType("botocore.config")
        config_module.Config = Mock(side_effect=lambda **kwargs: types.SimpleNamespace(**kwargs))
        modules = {"boto3": boto, "botocore": types.ModuleType("botocore"),
                   "botocore.config": config_module}
        previous = worker._client
        worker._client = None
        try:
            with patch.dict("sys.modules", modules), patch.dict("os.environ", {"UPLOAD_BUCKET": fixture.BUCKET}):
                self.assertEqual(worker.lambda_handler(fixture.event(), None), {"created": 1, "skipped": 0})
                self.assertEqual(worker.lambda_handler(fixture.event(), None), {"created": 0, "skipped": 1})
            boto.client.assert_called_once()
            kwargs = config_module.Config.call_args.kwargs
            self.assertEqual((kwargs["connect_timeout"], kwargs["read_timeout"]), (3, 3))
            self.assertEqual(kwargs["retries"], {"mode": "standard", "total_max_attempts": 3})
        finally:
            worker._client = previous

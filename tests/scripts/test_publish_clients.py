"""Exercise release publication failures without touching the production document root."""
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[2] / 'scripts/publish-clients.py'


class PublishClientsTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name)
        self.source = self.root / 'source'
        self.destination = self.root / 'published'
        (self.source / 'android').mkdir(parents=True)

    def prepare(self, code=2, payload=b'signed-release-fixture', certificate='a' * 64):
        (self.source / 'android' / f'highpass-{code}.apk').write_bytes(payload)
        metadata = {'applicationId': 'com.highpass.player', 'versionCode': code, 'versionName': '1.1.0',
                    'sizeBytes': len(payload), 'downloadUrl': f'/downloads/android/highpass-{code}.apk',
                    'sha256': hashlib.sha256(payload).hexdigest(), 'signingCertificateSha256': certificate}
        self.write_metadata(metadata)
        return metadata

    def write_metadata(self, metadata):
        (self.source / 'android/latest.json').write_text(json.dumps(metadata))
        (self.source / 'clients.json').write_text(json.dumps({'android': metadata, 'roku': {'versionName': '1.1.0'}}))

    def publish(self, succeeds=True):
        result = subprocess.run(['python3', str(SCRIPT), str(self.source), '--destination', str(self.destination)], capture_output=True, text=True)
        self.assertEqual(result.returncode == 0, succeeds, result.stdout + result.stderr)
        return result

    def test_idempotent_publication_keeps_versioned_apk_and_download_link(self):
        metadata = self.prepare()
        (self.source / 'tv').mkdir()
        (self.source / 'tv/highpass-roku.zip').write_bytes(b'tv-fixture')
        self.publish()
        self.publish()
        self.assertEqual((self.destination / 'android/highpass-latest.apk').read_bytes(), b'signed-release-fixture')
        self.assertEqual(json.loads((self.destination / 'android/latest.json').read_text()), metadata)
        self.assertEqual((self.destination / 'tv/highpass-roku.zip').read_bytes(), b'tv-fixture')
        self.assertEqual((self.destination / 'android/highpass-2.apk').stat().st_mode & 0o777, 0o644)

    def test_corrupted_download_and_path_traversal_leave_previous_feed_untouched(self):
        self.prepare()
        self.publish()
        original = (self.destination / 'android/latest.json').read_bytes()
        metadata = self.prepare(code=3)
        (self.source / 'android/highpass-3.apk').write_bytes(b'corrupted')
        self.publish(False)
        self.assertEqual((self.destination / 'android/latest.json').read_bytes(), original)
        metadata['downloadUrl'] = '/downloads/android/../../outside.apk'
        self.write_metadata(metadata)
        self.publish(False)
        self.assertFalse((self.destination / 'android/highpass-3.apk').exists())

    def test_replacing_immutable_version_and_downgrade_are_rejected(self):
        self.prepare(code=3)
        self.publish()
        original = (self.destination / 'android/highpass-3.apk').read_bytes()
        self.prepare(code=3, payload=b'rebuilt-with-same-version')
        self.publish(False)
        self.assertEqual((self.destination / 'android/highpass-3.apk').read_bytes(), original)
        self.prepare(code=2)
        self.publish(False)
        self.assertEqual(json.loads((self.destination / 'android/latest.json').read_text())['versionCode'], 3)

    def test_mismatched_manifest_and_signing_identity_do_not_publish(self):
        self.prepare()
        self.publish()
        self.prepare(code=3, certificate='b' * 64)
        self.publish(False)
        self.assertFalse((self.destination / 'android/highpass-3.apk').exists())
        self.prepare(code=3)
        (self.source / 'clients.json').write_text('{"android": {"versionCode": 999}}')
        self.publish(False)
        self.assertEqual(json.loads((self.destination / 'android/latest.json').read_text())['versionCode'], 2)


if __name__ == '__main__':
    unittest.main()

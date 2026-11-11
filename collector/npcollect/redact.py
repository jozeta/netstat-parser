"""Scrubs known secret values from anything that is printed."""


class Redactor:
    def __init__(self):
        self._secrets = set()

    def add(self, secret: str) -> None:
        if secret:
            self._secrets.add(secret)

    def scrub(self, text: str) -> str:
        for secret in sorted(self._secrets, key=len, reverse=True):
            text = text.replace(secret, "***")
        return text

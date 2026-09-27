"""Shared SQLAlchemy registry for the application's database records."""

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    def __init__(self, **kwargs: object) -> None:
        for key, value in kwargs.items():
            if not hasattr(type(self), key):
                raise TypeError(f"{key!r} is an invalid keyword argument for {type(self).__name__}")
            setattr(self, key, value)
        # SQLModel populated Field defaults when a record was constructed.
        # SQLAlchemy column defaults normally run at INSERT, so retain that
        # behavior for code that reads a new record before it is flushed.
        for column in self.__table__.columns:
            if column.key not in kwargs and "init_default" in column.info:
                value = column.info["init_default"]
                setattr(self, column.key, value() if callable(value) else value)
